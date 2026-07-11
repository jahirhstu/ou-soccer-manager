"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { attendanceSchema, expenseSchema, paymentSchema, playerSchema, programSchema, seasonSchema, sessionSchema } from "../schemas";
import { hasPermission } from "../permissions";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "../supabase/server";
import { applySessionUsage } from "./session-usage";
import { requireEnabledProgramModule } from "../program-access";

async function requirePermission(permission: Parameters<typeof hasPermission>[1]) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, permission)) throw new Error("Unauthorized");
  return profile;
}

export async function saveProgram(formData: FormData) {
  const profile = await requirePermission("manage_all");
  if (!profile?.organization_id) throw new Error("No organization found for this account.");
  const parsed = programSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { data: enabledTemplate, error: templateError } = await supabase
    .from("organization_enabled_programs")
    .select("program_template_id,program_templates!inner(key,category,default_modules)")
    .eq("organization_id", profile.organization_id)
    .eq("program_template_id", parsed.program_template_id)
    .eq("enabled", true)
    .maybeSingle();
  if (templateError || !enabledTemplate) throw new Error(templateError?.message ?? "Program template is not enabled.");
  const templateValue: any = enabledTemplate.program_templates;
  const template = Array.isArray(templateValue) ? templateValue[0] : templateValue;
  const slug = await uniqueProgramSlug(supabase, profile.organization_id, parsed.name);
  const { data, error } = await supabase
    .from("programs")
    .insert({
      ...parsed,
      category: template.category,
      activity_type: template.key,
      slug,
      organization_id: profile.organization_id,
      created_by: profile.id
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (data?.id) {
    const { error: membershipError } = await supabase.from("program_members").insert({
      organization_id: profile.organization_id,
      program_id: data.id,
      profile_id: profile.id,
      role: "manager",
      status: "active"
    });
    if (membershipError) throw new Error(membershipError.message);
    const modules = (template.default_modules ?? []).map((moduleKey: string) => ({
      organization_id: profile.organization_id,
      program_id: data.id,
      module_key: moduleKey,
      enabled: true
    }));
    if (modules.length) {
      const { error: moduleError } = await supabase.from("program_modules").insert(modules);
      if (moduleError) throw new Error(moduleError.message);
    }
  }
  revalidatePath("/programs");
  redirect("/programs");
}

export async function saveSeason(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = seasonSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id;
  if (!programId) throw new Error("Select a program.");
  await requireEnabledProgramModule(supabase, profile.organization_id, programId, "activities");
  const { error } = await supabase.from("seasons").insert({ ...parsed, program_id: programId, created_by: profile.id });
  if (error) throw new Error(error.message);
  revalidatePath("/seasons");
  redirect("/seasons");
}

export async function saveSession(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = sessionSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getProgramIdForSeason(supabase, parsed.season_id));
  await requireEnabledProgramModule(supabase, profile.organization_id, programId, "activities");
  const playgroundId = parsed.playground_id ?? (parsed.location ? await findOrCreatePlayground(supabase, parsed.location, profile.id) : undefined);
  const { error } = await supabase.from("sessions").insert({ ...parsed, program_id: programId, playground_id: playgroundId, created_by: profile.id });
  if (error) throw new Error(error.message);
  revalidatePath("/sessions");
  redirect("/sessions");
}

export async function savePlayer(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = playerSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const program = await getCurrentProgram();
  if (!program?.id) throw new Error("Program context is required.");
  await requireEnabledProgramModule(supabase, profile.organization_id, program.id, "members");
  const { data: player, error } = await supabase.from("players").insert({ ...parsed, organization_id: profile.organization_id }).select("id").single();
  if (error) throw new Error(error.message);
  const { error: memberError } = await supabase.from("program_members").insert({
    organization_id: profile.organization_id,
    program_id: program.id,
    player_id: player.id,
    role: "member",
    status: "active"
  });
  if (memberError) throw new Error(memberError.message);
  revalidatePath("/players");
  redirect("/players");
}

export async function updatePlayer(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const playerId = String(formData.get("player_id"));
  const parsed = playerSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const { data: oldPlayer } = await supabase.from("players").select("*").eq("id", playerId).single();
  const { error } = await supabase.from("players").update(parsed).eq("id", playerId);
  if (error) throw new Error(error.message);
  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: "player_updated",
    entity_type: "players",
    entity_id: playerId,
    old_data: oldPlayer,
    new_data: parsed
  });
  revalidatePath("/players");
  revalidatePath(`/players/${playerId}`);
  redirect(`/players/${playerId}`);
}

export async function savePayment(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = paymentSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getProgramIdForPayment(supabase, parsed.season_id, parsed.session_id));
  await requireEnabledProgramModule(supabase, profile.organization_id, programId, "payments");
  const { data, error } = await supabase.from("payments").insert({ ...parsed, program_id: programId, created_by: profile.id }).select("id").single();
  if (error) throw new Error(error.message);
  await supabase.from("ledger_entries").insert({
    program_id: programId,
    season_id: parsed.season_id,
    session_id: parsed.session_id,
    player_id: parsed.player_id,
    type: "payment_received",
    amount: parsed.amount,
    sessions_count: parsed.sessions_covered,
    description: parsed.reference_note ?? "Manual payment recorded",
    created_by: profile.id
  });
  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: "payment_created",
    entity_type: "payments",
    entity_id: data?.id,
    new_data: parsed
  });
  revalidatePath("/payments");
  revalidatePath("/public/report");
  revalidatePath("/notifications");
  redirect("/payments?success=payment_saved");
}

export async function saveExpense(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const parsed = expenseSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getProgramIdForExpense(supabase, parsed.season_id, parsed.session_id, profile.organization_id));
  await requireEnabledProgramModule(supabase, profile.organization_id, programId, "expenses");
  const { data, error } = await supabase.from("club_expenses").insert({ ...parsed, program_id: programId, created_by: profile.id }).select("id").single();
  if (error) throw new Error(error.message);
  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: "expense_created",
    entity_type: "club_expenses",
    entity_id: data?.id,
    new_data: parsed
  });
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  redirect("/expenses");
}

export async function upsertAttendance(formData: FormData) {
  const profile = await requirePermission("manage_attendance");
  const parsed = attendanceSchema.parse(formDataToObject(formData));
  const supabase = await createSupabaseServerClient();
  const programId = parsed.program_id ?? (await getProgramIdForSession(supabase, parsed.session_id));
  await requireEnabledProgramModule(supabase, profile.organization_id, programId, "attendance");
  const { error } = await supabase
    .from("attendance")
    .upsert({ ...parsed, program_id: programId, created_by: profile.id }, { onConflict: "session_id,player_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/attendance");
}

export async function updateSessionPrice(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const sessionId = String(formData.get("session_id"));
  const price = formData.get("price_per_session");
  const parsedPrice = price === "" || price == null ? null : Number(price);
  const supabase = await createSupabaseServerClient();
  const programId = await getProgramIdForSession(supabase, sessionId);
  await requireEnabledProgramModule(supabase, profile.organization_id, programId, "activities");
  const { error } = await supabase
    .from("sessions")
    .update({ price_per_session: parsedPrice })
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}

export async function completeSession(formData: FormData) {
  const profile = await requirePermission("manage_finance");
  const sessionId = String(formData.get("session_id"));
  const supabase = await createSupabaseServerClient();
  const programId = await getProgramIdForSession(supabase, sessionId);
  await requireEnabledProgramModule(supabase, profile.organization_id, programId, "activities");

  await applySessionUsage({
    supabase,
    sessionId,
    actorId: profile.id,
    source: "session_completed",
    markSessionCompleted: true
  });

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  revalidatePath("/reports/payments");
}

export async function applySessionFeeWaiver(formData: FormData) {
  const profile = await requirePermission("manage_all");
  const sessionId = String(formData.get("session_id"));
  const playerId = String(formData.get("player_id"));
  const rawWaiverAmount = formData.get("waiver_amount");
  const waiverAmount = Number(rawWaiverAmount ?? 0);
  const waiverReason = String(formData.get("waiver_reason") ?? "").trim();

  if (!sessionId || !playerId) throw new Error("Session and player are required.");
  if (!Number.isFinite(waiverAmount) || waiverAmount < 0) throw new Error("Waiver amount must be zero or greater.");
  if (waiverAmount > 0 && !waiverReason) throw new Error("Waiver reason is required.");

  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id,season_id,program_id,price_per_session,seasons(price_per_session)")
    .eq("id", sessionId)
    .single();
  if (sessionError) throw new Error(sessionError.message);
  await requireEnabledProgramModule(supabase, profile.organization_id, session.program_id, "payments");

  const { data: attendance, error: attendanceError } = await supabase
    .from("attendance")
    .select("status")
    .eq("session_id", sessionId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (attendanceError) throw new Error(attendanceError.message);
  if (!attendance || !["confirmed", "played", "replacement"].includes(attendance.status)) {
    throw new Error("Waivers can only be applied to confirmed, played, or replacement attendance.");
  }

  const { data: existingCharge, error: chargeError } = await supabase
    .from("session_player_charges")
    .select("id,amount,original_amount,waiver_amount,ledger_entry_id")
    .eq("session_id", sessionId)
    .eq("player_id", playerId)
    .maybeSingle();
  if (chargeError) throw new Error(chargeError.message);

  const originalAmount = Number(existingCharge?.original_amount ?? existingCharge?.amount ?? session.price_per_session ?? (session.seasons as any)?.price_per_session ?? 0);
  if (waiverAmount > originalAmount) throw new Error("Waiver amount cannot exceed the original session fee.");

  const netAmount = Number((originalAmount - waiverAmount).toFixed(2));
  const waiverPayload = {
    amount: netAmount,
    original_amount: originalAmount,
    waiver_amount: waiverAmount,
    waiver_reason: waiverAmount > 0 ? waiverReason : null,
    waived_by: waiverAmount > 0 ? profile.id : null,
    waived_at: waiverAmount > 0 ? new Date().toISOString() : null
  };

  let chargeId = existingCharge?.id;
  let ledgerEntryId = existingCharge?.ledger_entry_id;
  if (existingCharge) {
    const { error } = await supabase
      .from("session_player_charges")
      .update(waiverPayload)
      .eq("id", existingCharge.id);
    if (error) throw new Error(error.message);
  } else {
    const { data: insertedCharge, error } = await supabase
      .from("session_player_charges")
      .insert({
        session_id: sessionId,
        season_id: session.season_id,
        program_id: session.program_id,
        player_id: playerId,
        sessions_count: 1,
        source: "manual",
        created_by: profile.id,
        ...waiverPayload
      })
      .select("id,ledger_entry_id")
      .single();
    if (error) throw new Error(error.message);
    chargeId = insertedCharge.id;
    ledgerEntryId = insertedCharge.ledger_entry_id;
  }

  if (ledgerEntryId) {
    const { error } = await supabase
      .from("ledger_entries")
      .update({
        amount: netAmount,
        description: waiverAmount > 0 ? `Session fee after waiver. Waived ${moneyForNote(waiverAmount)}: ${waiverReason}` : "Session fee waiver removed."
      })
      .eq("id", ledgerEntryId);
    if (error) throw new Error(error.message);
  }

  if (waiverAmount > 0) {
    const { error } = await supabase.from("ledger_entries").insert({
      program_id: session.program_id,
      season_id: session.season_id,
      session_id: sessionId,
      player_id: playerId,
      type: "fee_waived",
      amount: waiverAmount,
      sessions_count: 0,
      description: waiverReason,
      created_by: profile.id
    });
    if (error) throw new Error(error.message);
  }

  await supabase.from("audit_logs").insert({
    actor_id: profile.id,
    action: waiverAmount > 0 ? "session_fee_waived" : "session_fee_waiver_removed",
    entity_type: "session_player_charges",
    entity_id: chargeId,
    old_data: existingCharge,
    new_data: { session_id: sessionId, player_id: playerId, original_amount: originalAmount, waiver_amount: waiverAmount, amount: netAmount, waiver_reason: waiverPayload.waiver_reason }
  });

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath(`/players/${playerId}`);
  revalidatePath("/payments");
  revalidatePath("/reports/payments");
  revalidatePath("/dashboard");
  redirect("/payments?success=waiver_saved");
}

function formDataToObject(formData: FormData) {
  return Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, value === "" ? null : value])
  );
}

function moneyForNote(value: number) {
  return `$${value.toFixed(2)}`;
}

async function findOrCreatePlayground(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  name: string,
  actorId: string
) {
  const cleaned = name.trim();
  if (!cleaned) return undefined;
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

async function getProgramIdForSeason(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  seasonId: string
) {
  const { data, error } = await supabase.from("seasons").select("program_id").eq("id", seasonId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.program_id ?? undefined;
}

async function getProgramIdForSession(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  sessionId: string
) {
  const { data, error } = await supabase.from("sessions").select("program_id").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.program_id ?? undefined;
}

async function getProgramIdForPayment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  seasonId: string,
  sessionId?: string
) {
  if (sessionId) {
    const sessionProgramId = await getProgramIdForSession(supabase, sessionId);
    if (sessionProgramId) return sessionProgramId;
  }
  return getProgramIdForSeason(supabase, seasonId);
}

async function getProgramIdForExpense(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  seasonId: string | undefined,
  sessionId: string | undefined,
  organizationId?: string | null
) {
  if (sessionId) {
    const sessionProgramId = await getProgramIdForSession(supabase, sessionId);
    if (sessionProgramId) return sessionProgramId;
  }
  if (seasonId) {
    const seasonProgramId = await getProgramIdForSeason(supabase, seasonId);
    if (seasonProgramId) return seasonProgramId;
  }
  throw new Error("Select a program.");
}

async function uniqueProgramSlug(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  name: string
) {
  const base = normalizeSlug(name) || "program";
  let slug = base;
  let counter = 2;
  while (true) {
    const { data, error } = await supabase
      .from("programs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
    slug = `${base}-${counter}`;
    counter += 1;
  }
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
