"use server";

import { revalidatePath } from "next/cache";
import { whatsappParser } from "../parsers";
import { whatsappInputSchema } from "../schemas";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile } from "../supabase/server";
import { normalizePlayerName } from "../utils";
import { applySessionUsage } from "./session-usage";

export async function parseWhatsAppAction(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_finance")) return { error: unauthorizedImportMessage(profile) };
    const rawText = String(formData.get("rawText") ?? "");
    const parsed = await whatsappParser.parse(rawText);
    ensureSentPaymentsAreParsed(parsed);
    ensureTeamPlayersAreParsedPlayers(parsed);
    ensureTeamPlayersAreAttendance(parsed);
    return { parsed };
  } catch (error) {
    return { error: friendlyImportError(error, "parse") };
  }
}

export async function confirmWhatsAppImport(_: unknown, formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!hasPermission(profile?.role, "manage_finance")) return { error: unauthorizedImportMessage(profile) };
    const input = whatsappInputSchema.parse({
      rawText: formData.get("rawText"),
      seasonId: formData.get("seasonId") || undefined,
      sessionId: formData.get("sessionId") || undefined
    });
    const parsed = JSON.parse(String(formData.get("parsedJson")));
    ensureSentPaymentsAreParsed(parsed);
    const matches = new Map<string, string>();
    const ignoredNames = new Set<string>();
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("match_") || !value) continue;
      const parsedName = key.replace("match_", "");
      if (value === "__ignore__") {
        ignoredNames.add(parsedName);
      } else {
        matches.set(parsedName, String(value));
      }
    }
    removeIgnoredRows(parsed, ignoredNames);
    ensureTeamPlayersAreParsedPlayers(parsed);
    ensureTeamPlayersAreAttendance(parsed);

    const supabase = await createSupabaseServerClient();
    const targetSeasonId = await resolveTargetSeasonId({
      supabase,
      requestedSeasonId: input.seasonId,
      parsed,
      formData,
      actorId: profile.id
    });
    const targetSessionId = await resolveTargetSessionId({
      supabase,
      requestedSessionId: input.sessionId,
      seasonId: targetSeasonId,
      parsed,
      formData,
      actorId: profile.id
    });

    const playerIds = await resolveImportedPlayers({
      supabase,
      parsedPlayers: parsed.players ?? [],
      matches
    });

    for (const collection of [parsed.players, parsed.payments, parsed.attendance, parsed.goals]) {
      for (const row of collection ?? []) {
        const name = row.name ?? row.playerName ?? row.scorerName;
        const matchedPlayerId = name ? resolvePlayerId(playerIds, name) : undefined;
        const matchedScorerId = row.scorerName ? resolvePlayerId(playerIds, row.scorerName) : undefined;
        const matchedAssistId = row.assistName ? resolvePlayerId(playerIds, row.assistName) : undefined;
        if (matchedPlayerId) row.matchedPlayerId = matchedPlayerId;
        if (matchedScorerId) row.matchedScorerId = matchedScorerId;
        if (matchedAssistId) row.matchedAssistId = matchedAssistId;
      }
    }
    for (const dropout of parsed.dropouts ?? []) {
      const matchedOriginalPlayerId = dropout.originalPlayerName ? resolvePlayerId(playerIds, dropout.originalPlayerName) : undefined;
      const matchedReplacementPlayerId = dropout.replacementPlayerName ? resolvePlayerId(playerIds, dropout.replacementPlayerName) : undefined;
      if (matchedOriginalPlayerId) dropout.matchedOriginalPlayerId = matchedOriginalPlayerId;
      if (matchedReplacementPlayerId) dropout.matchedReplacementPlayerId = matchedReplacementPlayerId;
    }

    if (!targetSeasonId && (parsed.players?.length || parsed.payments?.length)) {
      return { error: "Choose a target season or choose Create season before confirming this import." };
    }
    if (parsed.importType === "session_update" && !targetSessionId && hasSessionRows(parsed)) {
      return { error: "Choose a target session or choose Create session before confirming attendance, goals, or dropouts." };
    }

    let teamIds = new Map<string, string>();
    if (targetSessionId && parsed.teams?.length) {
      teamIds = await upsertSessionTeams({
        supabase,
        sessionId: targetSessionId,
        teams: parsed.teams,
        playerIds,
        actorId: profile.id
      });
    }

    const { data: importRow, error } = await supabase
      .from("whatsapp_imports")
      .insert({
        season_id: targetSeasonId,
        session_id: targetSessionId,
        raw_text: input.rawText,
        parsed_json: parsed,
        status: "confirmed",
        confidence: parsed.confidence,
        created_by: profile.id,
        confirmed_by: profile.id,
        confirmed_at: new Date().toISOString()
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const sessionPrice = targetSessionId ? await getEffectiveSessionPrice(supabase, targetSessionId) : null;
    const creditBeforeSession =
      targetSeasonId && targetSessionId
        ? await getCreditBeforeSession(supabase, targetSeasonId, targetSessionId)
        : new Map<string, number>();

    for (const payment of parsed.payments ?? []) {
      if (!payment.matchedPlayerId || !targetSeasonId) continue;
      const parsedAmount = Number(payment.amount ?? 0);
      const parsedSessionsCovered = Number(payment.sessionsCovered ?? 0);
      const explicitAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
      const sentWithoutAmount = Boolean(parsed.importType === "session_update" && !explicitAmount && parsedSessionsCovered > 0);
      if (sentWithoutAmount && sessionPrice != null && (creditBeforeSession.get(payment.matchedPlayerId) ?? 0) >= sessionPrice) {
        await supabase.from("audit_logs").insert({
          actor_id: profile.id,
          action: "payment_import_skipped_credit_available",
          entity_type: "payments",
          new_data: {
            player_id: payment.matchedPlayerId,
            session_id: targetSessionId,
            season_id: targetSeasonId,
            import_id: importRow?.id,
            credit_before_session: creditBeforeSession.get(payment.matchedPlayerId) ?? 0,
            session_price: sessionPrice,
            payment
          }
        });
        continue;
      }

      const paymentAmount = Number(explicitAmount ? parsedAmount : sentWithoutAmount ? sessionPrice : null);
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        await supabase.from("audit_logs").insert({
          actor_id: profile.id,
          action: "payment_import_skipped_no_amount",
          entity_type: "payments",
          new_data: {
            player_id: payment.matchedPlayerId,
            session_id: parsed.importType === "session_update" ? targetSessionId : null,
            season_id: targetSeasonId,
            import_id: importRow?.id,
            session_price: sessionPrice,
            payment
          }
        });
        continue;
      }
      const sessionsCovered =
        (Number.isFinite(parsedSessionsCovered) && parsedSessionsCovered > 0 ? parsedSessionsCovered : null) ??
        (parsed.importType === "session_update" ? sessionsCoveredFromAmount(paymentAmount, sessionPrice) : null);
      const paymentRow = await importPaymentOnce({
        supabase,
        seasonId: targetSeasonId,
        sessionId: parsed.importType === "session_update" ? targetSessionId : null,
        playerId: payment.matchedPlayerId,
        amount: paymentAmount,
        sessionsCovered,
        paymentMethod: payment.paymentMethod || "e-transfer",
        note: payment.note,
        importId: importRow?.id,
        actorId: profile.id
      });
      if (!paymentRow) {
        await supabase.from("audit_logs").insert({
          actor_id: profile.id,
          action: "payment_import_skipped_existing",
          entity_type: "payments",
          new_data: {
            player_id: payment.matchedPlayerId,
            session_id: parsed.importType === "session_update" ? targetSessionId : null,
            season_id: targetSeasonId,
            import_id: importRow?.id,
            payment
          }
        });
        continue;
      }

      const { error: ledgerError } = await supabase.from("ledger_entries").insert({
        season_id: targetSeasonId,
        player_id: payment.matchedPlayerId,
        session_id: parsed.importType === "session_update" ? targetSessionId : null,
        type: "payment_received",
        amount: paymentAmount,
        sessions_count: sessionsCovered,
        description: `WhatsApp import ${importRow?.id}: ${payment.note ?? ""}`,
        created_by: profile.id
      });
      if (ledgerError) throw new Error(ledgerError.message);

      await supabase.from("audit_logs").insert({
        actor_id: profile.id,
        action: "payment_imported",
        entity_type: "payments",
        entity_id: paymentRow?.id,
        new_data: payment
      });
    }

    for (const row of parsed.attendance ?? []) {
      if (!row.matchedPlayerId || !targetSessionId) continue;
      await supabase.from("attendance").upsert(
        {
          session_id: targetSessionId,
          player_id: row.matchedPlayerId,
          status: row.status,
          created_by: profile.id
        },
        { onConflict: "session_id,player_id" }
      );
    }

    for (const goal of parsed.goals ?? []) {
      if (!goal.matchedScorerId || !targetSessionId) continue;
      await upsertImportedGoal({
        supabase,
        session_id: targetSessionId,
        scorerId: goal.matchedScorerId,
        assistPlayerId: goal.matchedAssistId,
        sessionTeamId: goal.teamName ? teamIds.get(normalizeNameKey(goal.teamName)) : null,
        team: goal.team,
        goalCount: goal.count ?? 1,
        note: goal.note,
        actorId: profile.id
      });
    }
    if (targetSessionId) {
      await cleanupDuplicateGoalsForSession(supabase, targetSessionId);
    }

    for (const dropout of parsed.dropouts ?? []) {
      if (!dropout.matchedOriginalPlayerId || !targetSessionId) continue;
      await supabase.from("dropouts").insert({
        session_id: targetSessionId,
        original_player_id: dropout.matchedOriginalPlayerId,
        replacement_player_id: dropout.matchedReplacementPlayerId,
        transfer_type: dropout.transferType ?? "manual_adjustment",
        notes: dropout.note,
        created_by: profile.id
      });
    }

    if (parsed.importType === "session_update" && targetSessionId) {
      await applySessionUsage({
        supabase,
        sessionId: targetSessionId,
        actorId: profile.id,
        source: "whatsapp_import"
      });
    }

    revalidatePath("/import-whatsapp");
    revalidatePath("/reports/payments");
    revalidatePath("/reports/attendance");
    revalidatePath("/seasons");
    revalidatePath("/sessions");
    if (targetSessionId) revalidatePath(`/sessions/${targetSessionId}`);
    return { success: true, message: "WhatsApp import confirmed successfully." };
  } catch (error) {
    return { error: friendlyImportError(error, "confirm") };
  }
}

function unauthorizedImportMessage(profile: {
  email?: string | null;
  role?: string | null;
  authUserEmail?: string | null;
  authError?: string | null;
  profileError?: string | null;
} | null) {
  if (profile?.authError) {
    return `Unauthorized. Supabase auth error: ${profile.authError}. Log in again.`;
  }

  if (profile?.profileError) {
    return `Unauthorized. Logged in as ${profile.authUserEmail ?? "unknown email"}, but profile lookup failed: ${profile.profileError}`;
  }

  if (!profile) {
    return "Unauthorized. No logged-in profile was found. Log out, log back in, then run seed again if needed.";
  }

  return `Unauthorized. Logged in as ${profile.email ?? "unknown email"} with role "${profile.role ?? "none"}". WhatsApp import requires admin role.`;
}

function friendlyImportError(error: unknown, step: "parse" | "confirm") {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = step === "parse" ? "Could not parse the WhatsApp message." : "Could not confirm the WhatsApp import.";

  if (/invalid input syntax for type time/i.test(message)) {
    return `${prefix} One of the parsed time values is not valid. Review the session start/end time fields and use HH:MM format, or leave them blank.`;
  }

  if (/invalid input syntax for type date/i.test(message)) {
    return `${prefix} One of the parsed date values is not valid. Review the season/session date fields and use YYYY-MM-DD format.`;
  }

  if (/uuid/i.test(message)) {
    return `${prefix} A required season, session, or player selection is missing or invalid. Review the dropdown selections and try again.`;
  }

  if (/duplicate key/i.test(message)) {
    return `${prefix} Some of this information already exists. Review the selected season/session and imported names, then try again.`;
  }

  if (/permission denied|row-level security|violates row-level security/i.test(message)) {
    return `${prefix} Your account does not have database permission for this action. Make sure your profile role is admin and the migration grants were applied.`;
  }

  if (/Parsed session needs a date/i.test(message)) {
    return `${prefix} A new session needs a session date. Add it in the Review and fix section, or choose an existing session.`;
  }

  if (/Choose or create a target season/i.test(message)) {
    return `${prefix} A new session needs a target season. Choose an existing season or create the season from the parsed details.`;
  }

  return `${prefix} ${message || "Review the parsed details and try again."}`;
}

async function resolveTargetSeasonId({
  supabase,
  requestedSeasonId,
  parsed,
  formData,
  actorId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  requestedSeasonId?: string;
  parsed: any;
  formData: FormData;
  actorId: string;
}) {
  if (!requestedSeasonId) return undefined;
  if (requestedSeasonId !== "__create__") {
    const { error } = await supabase
      .from("seasons")
      .update({
        name: formValue(formData, "createSeasonName") || parsed.season?.name || "Imported season",
        start_date: nullableFormValue(formData, "createSeasonStartDate"),
        end_date: nullableFormValue(formData, "createSeasonEndDate"),
        total_planned_sessions: numberValue(formData, "createSeasonTotalSessions") ?? null,
        price_per_session: numberValue(formData, "createSeasonPricePerSession") ?? parsed.season?.pricePerSession ?? parsed.session?.pricePerSession ?? 0
      })
      .eq("id", requestedSeasonId);
    if (error) throw new Error(error.message);
    return requestedSeasonId;
  }

  const name = formValue(formData, "createSeasonName") || parsed.season?.name || "Imported season";
  const pricePerSession = numberValue(formData, "createSeasonPricePerSession") ?? parsed.season?.pricePerSession ?? parsed.session?.pricePerSession ?? 0;

  const { data, error } = await supabase
    .from("seasons")
    .insert({
      name,
      start_date: formValue(formData, "createSeasonStartDate") || parsed.season?.startDate || parsed.session?.date || null,
      end_date: formValue(formData, "createSeasonEndDate") || parsed.season?.endDate || null,
      total_planned_sessions: numberValue(formData, "createSeasonTotalSessions") ?? parsed.season?.totalSessions ?? parsed.session?.totalSessions ?? null,
      price_per_session: pricePerSession,
      status: "active",
      notes: "Created from WhatsApp import",
      created_by: actorId
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function resolveTargetSessionId({
  supabase,
  requestedSessionId,
  seasonId,
  parsed,
  formData,
  actorId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  requestedSessionId?: string;
  seasonId?: string;
  parsed: any;
  formData: FormData;
  actorId: string;
}) {
  if (!requestedSessionId) return undefined;
  if (requestedSessionId !== "__create__") {
    const location = nullableFormValue(formData, "createSessionLocation");
    const playgroundId = location ? await findOrCreatePlayground(supabase, location, actorId) : null;
    const sessionDate = formValue(formData, "createSessionDate") || parsed.session?.date;
    if (!sessionDate) throw new Error("Parsed session needs a date before it can be updated.");
    const duration = formValue(formData, "createSessionDuration");
    const updatePayload: Record<string, unknown> = {
      playground_id: playgroundId,
      name: nullableFormValue(formData, "createSessionName"),
      session_date: sessionDate,
      location,
      start_time: nullableFormValue(formData, "createSessionStartTime"),
      end_time: nullableFormValue(formData, "createSessionEndTime"),
      price_per_session: numberValue(formData, "createSessionPricePerSession") ?? null
    };
    if (seasonId) updatePayload.season_id = seasonId;
    if (duration) updatePayload.notes = `Duration: ${duration}. Updated from WhatsApp import.`;
    const { error } = await supabase
      .from("sessions")
      .update(updatePayload)
      .eq("id", requestedSessionId);
    if (error) throw new Error(error.message);
    return requestedSessionId;
  }
  if (!seasonId) throw new Error("Choose or create a target season before creating a session.");

  const sessionDate = formValue(formData, "createSessionDate") || parsed.session?.date;
  if (!sessionDate) throw new Error("Parsed session needs a date before it can be created.");

  const duration = formValue(formData, "createSessionDuration") || parsed.session?.duration;
  const location = formValue(formData, "createSessionLocation") || parsed.session?.location || null;
  const playgroundId = location ? await findOrCreatePlayground(supabase, location, actorId) : null;
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      season_id: seasonId,
      playground_id: playgroundId,
      name: formValue(formData, "createSessionName") || parsed.session?.name || null,
      session_date: sessionDate,
      location,
      start_time: formValue(formData, "createSessionStartTime") || parsed.session?.startTime || null,
      end_time: formValue(formData, "createSessionEndTime") || parsed.session?.endTime || null,
      price_per_session: numberValue(formData, "createSessionPricePerSession") ?? parsed.session?.pricePerSession ?? null,
      status: "scheduled",
      notes: duration ? `Duration: ${duration}. Created from WhatsApp import.` : "Created from WhatsApp import",
      created_by: actorId
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

function formValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

function nullableFormValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function numberValue(formData: FormData, key: string) {
  const value = formValue(formData, key);
  if (value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function findOrCreatePlayground(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  name: string,
  actorId: string
) {
  const cleaned = name.trim();
  const { data: existing, error: existingError } = await supabase
    .from("playgrounds")
    .select("id")
    .ilike("name", cleaned)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("playgrounds")
    .insert({ name: cleaned, created_by: actorId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function getEffectiveSessionPrice(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  sessionId: string
) {
  const { data, error } = await supabase
    .from("sessions")
    .select("price_per_session,seasons(price_per_session)")
    .eq("id", sessionId)
    .single();
  if (error) throw new Error(error.message);
  return Number(data.price_per_session ?? (data.seasons as any)?.price_per_session ?? 0);
}

async function importPaymentOnce({
  supabase,
  seasonId,
  sessionId,
  playerId,
  amount,
  sessionsCovered,
  paymentMethod,
  note,
  importId,
  actorId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  seasonId: string;
  sessionId: string | null | undefined;
  playerId: string;
  amount: number;
  sessionsCovered: number | null;
  paymentMethod?: string;
  note?: string;
  importId?: string;
  actorId: string;
}) {
  if (sessionId) {
    const { data: existingLedger, error: existingLedgerError } = await supabase
      .from("ledger_entries")
      .select("id")
      .eq("season_id", seasonId)
      .eq("session_id", sessionId)
      .eq("player_id", playerId)
      .eq("type", "payment_received")
      .maybeSingle();
    if (existingLedgerError) throw new Error(existingLedgerError.message);
    if (existingLedger) return null;
  }

  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .insert({
      season_id: seasonId,
      player_id: playerId,
      amount,
      sessions_covered: sessionsCovered,
      payment_method: paymentMethod || "e-transfer",
      reference_note: `WhatsApp import ${importId}: ${note ?? ""}`,
      created_by: actorId
    })
    .select("id")
    .single();
  if (paymentError) throw new Error(paymentError.message);

  return paymentRow;
}

async function getCreditBeforeSession(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  seasonId: string,
  sessionId: string
) {
  const { data, error } = await supabase
    .from("ledger_entries")
    .select("player_id,type,amount,session_id")
    .eq("season_id", seasonId);
  if (error) throw new Error(error.message);

  const creditByPlayer = new Map<string, number>();
  for (const entry of data ?? []) {
    if (entry.session_id === sessionId) continue;
    const amount = Number(entry.amount ?? 0);
    const current = creditByPlayer.get(entry.player_id) ?? 0;

    if (["payment_received", "credit_added", "credit_transferred_in"].includes(entry.type)) {
      creditByPlayer.set(entry.player_id, current + amount);
    }

    if (["session_used", "credit_transferred_out", "refund_paid"].includes(entry.type)) {
      creditByPlayer.set(entry.player_id, current - amount);
    }
  }

  return creditByPlayer;
}

async function upsertImportedGoal({
  supabase,
  session_id,
  scorerId,
  assistPlayerId,
  sessionTeamId,
  team,
  goalCount,
  note,
  actorId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  session_id: string;
  scorerId: string;
  assistPlayerId?: string;
  sessionTeamId?: string | null;
  team?: "A" | "B";
  goalCount: number;
  note?: string;
  actorId: string;
}) {
  let query = supabase
    .from("goals")
    .select("id")
    .eq("session_id", session_id)
    .eq("scorer_id", scorerId);

  query = sessionTeamId ? query.eq("session_team_id", sessionTeamId) : query.is("session_team_id", null);
  query = team ? query.eq("team", team) : query.is("team", null);

  const { data: existingGoals, error: existingError } = await query.order("created_at", { ascending: true });
  if (existingError) throw new Error(existingError.message);

  const payload = {
    session_id,
    scorer_id: scorerId,
    assist_player_id: assistPlayerId,
    session_team_id: sessionTeamId ?? null,
    team,
    goal_count: goalCount,
    notes: note,
    created_by: actorId
  };

  const existingGoal = existingGoals?.[0];
  if (existingGoal) {
    const duplicateGoalIds = (existingGoals ?? []).slice(1).map((goal) => goal.id);
    const { error } = await supabase
      .from("goals")
      .update({
        assist_player_id: assistPlayerId,
        session_team_id: sessionTeamId ?? null,
        team,
        goal_count: goalCount,
        notes: note
      })
      .eq("id", existingGoal.id);
    if (error) throw new Error(error.message);

    if (duplicateGoalIds.length) {
      const { error: deleteError } = await supabase.from("goals").delete().in("id", duplicateGoalIds);
      if (deleteError) throw new Error(deleteError.message);
    }
    return;
  }

  const { error } = await supabase.from("goals").insert(payload);
  if (error) throw new Error(error.message);
}

async function cleanupDuplicateGoalsForSession(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  sessionId: string
) {
  const { data, error } = await supabase
    .from("goals")
    .select("id,scorer_id,assist_player_id,session_team_id,team,goal_count,notes,created_at,updated_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const grouped = new Map<string, any[]>();
  for (const goal of data ?? []) {
    const key = [goal.scorer_id, goal.session_team_id ?? "", goal.team ?? "", goal.assist_player_id ?? ""].join(":");
    grouped.set(key, [...(grouped.get(key) ?? []), goal]);
  }

  for (const goals of grouped.values()) {
    if (!goals || goals.length < 2) continue;
    const keeper = goals[0];
    const latest = goals.reduce((current, goal) =>
      String(goal.updated_at ?? goal.created_at) > String(current.updated_at ?? current.created_at) ? goal : current
    );
    const duplicateIds = goals.slice(1).map((goal) => goal.id);

    const { error: updateError } = await supabase
      .from("goals")
      .update({
        goal_count: latest.goal_count,
        notes: latest.notes
      })
      .eq("id", keeper.id);
    if (updateError) throw new Error(updateError.message);

    const { error: deleteError } = await supabase.from("goals").delete().in("id", duplicateIds);
    if (deleteError) throw new Error(deleteError.message);
  }
}

function sessionsCoveredFromAmount(amount: number, sessionPrice: number | null) {
  if (!sessionPrice) return 1;
  return Number((amount / sessionPrice).toFixed(2));
}

function removeIgnoredRows(parsed: any, ignoredNames: Set<string>) {
  if (!ignoredNames.size) return;

  parsed.players = (parsed.players ?? []).filter((player: any) => !ignoredNames.has(player.name));
  parsed.payments = (parsed.payments ?? []).filter((payment: any) => !ignoredNames.has(payment.playerName));
  parsed.attendance = (parsed.attendance ?? []).filter((row: any) => !ignoredNames.has(row.playerName));
  parsed.goals = (parsed.goals ?? []).filter(
    (goal: any) => !ignoredNames.has(goal.scorerName) && (!goal.assistName || !ignoredNames.has(goal.assistName))
  );
  parsed.dropouts = (parsed.dropouts ?? []).filter(
    (dropout: any) =>
      !ignoredNames.has(dropout.originalPlayerName) &&
      (!dropout.replacementPlayerName || !ignoredNames.has(dropout.replacementPlayerName))
  );
  parsed.teams = (parsed.teams ?? [])
    .map((team: any) => ({
      ...team,
      captainName: team.captainName && !ignoredNames.has(team.captainName) ? team.captainName : undefined,
      players: (team.players ?? []).filter((playerName: string) => !ignoredNames.has(playerName))
    }))
    .filter((team: any) => team.players.length || team.captainName || team.score != null);

  parsed.warnings = [
    ...(parsed.warnings ?? []),
    ...Array.from(ignoredNames).map((name) => `Ignored parsed name during confirmation: ${name}.`)
  ];
}

function ensureSentPaymentsAreParsed(parsed: any) {
  if (parsed.importType !== "session_update" || !parsed.rawText) return;

  const existingPayments = new Set((parsed.payments ?? []).map((payment: any) => normalizeNameKey(payment.playerName)));
  const knownNames = new Set([
    ...(parsed.players ?? []).map((player: any) => normalizeNameKey(player.name)),
    ...(parsed.attendance ?? []).map((row: any) => normalizeNameKey(row.playerName))
  ]);

  for (const line of String(parsed.rawText).split(/\r?\n/)) {
    if (!/\bsent\b/i.test(line)) continue;
    const name = extractSentPaymentName(line);
    if (!name) continue;

    const key = normalizeNameKey(name);
    if (existingPayments.has(key)) continue;

    parsed.payments ??= [];
    parsed.payments.push({
      playerName: name,
      sessionsCovered: 1,
      paymentMethod: "e-transfer",
      note: line.trim(),
      confidence: "high"
    });
    existingPayments.add(key);

    if (!knownNames.has(key)) {
      parsed.players ??= [];
      parsed.players.push({ name, confidence: "medium" });
      if (parsed.importType === "session_update") {
        parsed.attendance ??= [];
        parsed.attendance.push({ playerName: name, status: "confirmed", confidence: "medium" });
      }
      knownNames.add(key);
    }
  }
}

function extractSentPaymentName(line: string) {
  const cleaned = line
    .replace(/^\s*\d{1,3}[.)]?\s*/u, "")
    .replace(/[\u2007\u2060\u034f]/g, " ")
    .trim();
  const match = cleaned.match(/^(.+?)(?:\s*[-–:]\s*)?\bsent\b/i);
  const rawName = match?.[1]?.replace(/[^\p{L}\p{M}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!rawName || /\b(payment|interac|etransfer|e-transfer|money|amount)\b/i.test(rawName)) return undefined;
  return normalizePlayerName(rawName);
}

function ensureTeamPlayersAreParsedPlayers(parsed: any) {
  const existing = new Set((parsed.players ?? []).map((player: any) => normalizeNameKey(player.name)));
  for (const team of parsed.teams ?? []) {
    for (const playerName of teamMemberNames(team)) {
      const key = normalizeNameKey(playerName);
      if (existing.has(key)) continue;
      parsed.players ??= [];
      parsed.players.push({ name: normalizePlayerName(playerName), confidence: team.confidence ?? "medium" });
      existing.add(key);
    }
  }
}

function ensureTeamPlayersAreAttendance(parsed: any) {
  if (parsed.importType !== "session_update") return;
  const existing = new Set((parsed.attendance ?? []).map((row: any) => normalizeNameKey(row.playerName)));
  for (const team of parsed.teams ?? []) {
    for (const playerName of teamMemberNames(team)) {
      const key = normalizeNameKey(playerName);
      if (existing.has(key)) continue;
      parsed.attendance ??= [];
      parsed.attendance.push({ playerName: normalizePlayerName(playerName), status: "confirmed", confidence: team.confidence ?? "medium" });
      existing.add(key);
    }
  }
}

function hasSessionRows(parsed: any) {
  return Boolean(parsed.attendance?.length || parsed.goals?.length || parsed.dropouts?.length || parsed.score);
}

async function resolveImportedPlayers({
  supabase,
  parsedPlayers,
  matches
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  parsedPlayers: Array<{ name: string; matchedPlayerId?: string }>;
  matches: Map<string, string>;
}) {
  const playerIds = new Map<string, string>();
  const { data: existingPlayers, error } = await supabase.from("players").select("id,display_name");
  if (error) throw new Error(error.message);

  const existingByName = new Map(
    (existingPlayers ?? []).map((player) => [normalizePlayerName(player.display_name), player.id])
  );

  for (const player of parsedPlayers) {
    if (matches.has(player.name)) {
      setPlayerId(playerIds, player.name, matches.get(player.name)!);
      continue;
    }

    const normalizedName = normalizePlayerName(player.name);
    const existingId = existingByName.get(normalizedName);
    if (existingId) {
      setPlayerId(playerIds, player.name, existingId);
      continue;
    }

    const { data: created, error: createError } = await supabase
      .from("players")
      .insert({ display_name: normalizedName, status: "active", notes: "Created from WhatsApp import" })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);
    setPlayerId(playerIds, player.name, created.id);
    existingByName.set(normalizedName, created.id);
  }

  return playerIds;
}

function setPlayerId(playerIds: Map<string, string>, name: string, id: string) {
  playerIds.set(name, id);
  playerIds.set(normalizePlayerName(name), id);
  playerIds.set(normalizeNameKey(name), id);
}

async function upsertSessionTeams({
  supabase,
  sessionId,
  teams,
  playerIds,
  actorId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  sessionId: string;
  teams: Array<{ name?: string; teamName?: string; team_name?: string; label?: string; captainName?: string; score?: number; players?: string[] }>;
  playerIds: Map<string, string>;
  actorId: string;
}) {
  const teamIds = new Map<string, string>();

  for (const team of teams) {
    const teamName = getTeamName(team);
    if (!teamName) continue;
    const captainPlayerId = team.captainName ? resolvePlayerId(playerIds, team.captainName) : null;
    const teamPayload = {
      session_id: sessionId,
      name: teamName,
      label: team.label ?? teamName,
      created_by: actorId,
      ...(team.score != null ? { score: team.score } : {}),
      ...(team.captainName ? { captain_player_id: captainPlayerId } : {})
    };
    const { data, error } = await supabase
      .from("session_teams")
      .upsert(teamPayload, { onConflict: "session_id,name" })
      .select("id,name")
      .single();
    if (error) throw new Error(error.message);

    teamIds.set(normalizeNameKey(data.name), data.id);

    for (const playerName of uniqueTeamPlayerNames(team)) {
      const playerId = resolvePlayerId(playerIds, playerName);
      if (!playerId) continue;
      await supabase.from("session_team_players").upsert(
        {
          session_team_id: data.id,
          session_id: sessionId,
          player_id: playerId,
          created_by: actorId
        },
        { onConflict: "session_id,player_id" }
      );
    }
  }

  return teamIds;
}

function getTeamName(team: { name?: string; teamName?: string; team_name?: string; label?: string }) {
  return (team.name ?? team.teamName ?? team.team_name ?? team.label ?? "").trim();
}

function uniqueTeamPlayerNames(team: { captainName?: string; players?: string[] }) {
  const names = new Map<string, string>();
  for (const playerName of teamMemberNames(team)) {
    names.set(normalizeNameKey(playerName), playerName);
  }
  return Array.from(names.values());
}

function teamMemberNames(team: { captainName?: string; players?: string[] }) {
  return [...(team.players ?? []), ...(team.captainName ? [team.captainName] : [])];
}

function resolvePlayerId(playerIds: Map<string, string>, playerName: string) {
  return playerIds.get(playerName) ?? playerIds.get(normalizePlayerName(playerName));
}

function normalizeNameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
