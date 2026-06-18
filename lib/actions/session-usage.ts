import { createSupabaseServerClient } from "../supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function applySessionUsage({
  supabase,
  sessionId,
  actorId,
  source,
  markSessionCompleted = false
}: {
  supabase: SupabaseClient;
  sessionId: string;
  actorId: string;
  source: "whatsapp_import" | "session_completed";
  markSessionCompleted?: boolean;
}) {
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id,season_id,session_date,status,price_per_session,seasons(price_per_session)")
    .eq("id", sessionId)
    .single();
  if (sessionError) throw new Error(sessionError.message);

  const effectivePrice = Number(session.price_per_session ?? (session.seasons as any)?.price_per_session ?? 0);
  const shouldMarkConfirmedPlayed = markSessionCompleted || session.status === "completed" || String(session.session_date) < currentDateString();

  const { data: attendance, error: attendanceError } = await supabase
    .from("attendance")
    .select("player_id,status")
    .eq("session_id", sessionId);
  if (attendanceError) throw new Error(attendanceError.message);

  const billableAttendance = (attendance ?? []).filter((row) => ["confirmed", "played", "replacement"].includes(row.status));
  const nonBillablePlayerIds = (attendance ?? [])
    .filter((row) => !["confirmed", "played", "replacement"].includes(row.status))
    .map((row) => row.player_id);

  const removedCharges = nonBillablePlayerIds.length
    ? await removeNonBillableSessionCharges({ supabase, sessionId, playerIds: nonBillablePlayerIds })
    : 0;

  const confirmedPlayerIds = billableAttendance
    .filter((row) => row.status === "confirmed")
    .map((row) => row.player_id);

  if (shouldMarkConfirmedPlayed && confirmedPlayerIds.length) {
    const { error } = await supabase
      .from("attendance")
      .update({ status: "played" })
      .eq("session_id", sessionId)
      .in("player_id", confirmedPlayerIds);
    if (error) throw new Error(error.message);
  }

  const newCharges = [];
  for (const row of billableAttendance) {
    const { data: charge, error } = await supabase
      .from("session_player_charges")
      .insert({
        season_id: session.season_id,
        player_id: row.player_id,
        session_id: sessionId,
        amount: effectivePrice,
        original_amount: effectivePrice,
        waiver_amount: 0,
        sessions_count: 1,
        source,
        created_by: actorId
      })
      .select("id,player_id")
      .single();

    if (error) {
      if (isUniqueViolation(error)) continue;
      throw new Error(error.message);
    }

    newCharges.push({
      chargeId: charge.id,
      playerId: charge.player_id,
      status: row.status === "confirmed" && shouldMarkConfirmedPlayed ? "played" : row.status
    });
  }

  const ledgerRows = newCharges.map((charge) => ({
      season_id: session.season_id,
      player_id: charge.playerId,
      session_id: sessionId,
      type: "session_used",
      amount: effectivePrice,
      sessions_count: 1,
      description: `${source === "whatsapp_import" ? "WhatsApp session import" : "Session completed"}. Status: ${
        charge.status === "confirmed" ? "played" : charge.status
      }.`,
      created_by: actorId
    }));

  if (ledgerRows.length) {
    const { data: insertedLedger, error } = await supabase.from("ledger_entries").insert(ledgerRows).select("id,player_id");
    if (error) throw new Error(error.message);

    for (const ledgerEntry of insertedLedger ?? []) {
      const charge = newCharges.find((row) => row.playerId === ledgerEntry.player_id);
      if (!charge) continue;
      await supabase
        .from("session_player_charges")
        .update({ ledger_entry_id: ledgerEntry.id })
        .eq("id", charge.chargeId);
    }
  }

  if (markSessionCompleted) {
    const { error } = await supabase.from("sessions").update({ status: "completed" }).eq("id", sessionId);
    if (error) throw new Error(error.message);
  }

  await supabase.from("audit_logs").insert({
    actor_id: actorId,
    action: source === "whatsapp_import" ? "session_usage_imported" : "session_completed",
    entity_type: "sessions",
    entity_id: sessionId,
    new_data: {
      charged_players: ledgerRows.length,
      skipped_existing_charges: billableAttendance.length - newCharges.length,
      removed_non_billable_charges: removedCharges,
      price_per_session: effectivePrice,
      confirmed_changed_to_played: shouldMarkConfirmedPlayed ? confirmedPlayerIds.length : 0
    }
  });

  return {
    chargedPlayers: ledgerRows.length,
    skippedExistingCharges: billableAttendance.length - newCharges.length,
    removedNonBillableCharges: removedCharges,
    confirmedChangedToPlayed: shouldMarkConfirmedPlayed ? confirmedPlayerIds.length : 0,
    effectivePrice
  };
}

async function removeNonBillableSessionCharges({
  supabase,
  sessionId,
  playerIds
}: {
  supabase: SupabaseClient;
  sessionId: string;
  playerIds: string[];
}) {
  const { data: charges, error } = await supabase
    .from("session_player_charges")
    .select("id,ledger_entry_id")
    .eq("session_id", sessionId)
    .in("player_id", playerIds);
  if (error) throw new Error(error.message);
  if (!charges?.length) return 0;

  const chargeIds = charges.map((charge) => charge.id);
  const ledgerEntryIds = charges.map((charge) => charge.ledger_entry_id).filter(Boolean);

  const { error: chargeDeleteError } = await supabase
    .from("session_player_charges")
    .delete()
    .in("id", chargeIds);
  if (chargeDeleteError) throw new Error(chargeDeleteError.message);

  if (ledgerEntryIds.length) {
    const { error: ledgerDeleteError } = await supabase
      .from("ledger_entries")
      .delete()
      .in("id", ledgerEntryIds);
    if (ledgerDeleteError) throw new Error(ledgerDeleteError.message);
  }

  return charges.length;
}

function isUniqueViolation(error: { code?: string; message?: string }) {
  return error.code === "23505" || /duplicate key value violates unique constraint/i.test(error.message ?? "");
}

function currentDateString() {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Toronto",
    year: "numeric"
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
