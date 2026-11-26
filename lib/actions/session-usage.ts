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
  source: "whatsapp_import" | "session_completed" | "manual";
  markSessionCompleted?: boolean;
}) {
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id,organization_id,season_id,program_id,session_date,status,price_per_session,seasons(price_per_session,program_id)")
    .eq("id", sessionId)
    .single();
  if (sessionError) throw new Error(sessionError.message);

  const effectivePrice = Number(session.price_per_session ?? (session.seasons as any)?.price_per_session ?? 0);
  const programId = session.program_id ?? (session.seasons as any)?.program_id ?? null;
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

  let chargedPlayers=0,skippedExistingCharges=0;
  for (const row of billableAttendance) {
    let lookup=await supabase.from('session_player_charges').select('id,player_id,amount,ledger_entry_id').eq('session_id',sessionId).eq('player_id',row.player_id).maybeSingle();
    if(lookup.error)throw new Error(lookup.error.message);
    let charge=lookup.data;
    if(!charge) {
      const inserted=await supabase.from('session_player_charges').insert({season_id:session.season_id,program_id:programId,player_id:row.player_id,session_id:sessionId,amount:effectivePrice,original_amount:effectivePrice,waiver_amount:0,sessions_count:1,source,created_by:actorId}).select('id,player_id,amount,ledger_entry_id').single();
      if(inserted.error && !isUniqueViolation(inserted.error))throw new Error(inserted.error.message);
      charge=inserted.data;
      if(!charge) {
        lookup=await supabase.from('session_player_charges').select('id,player_id,amount,ledger_entry_id').eq('session_id',sessionId).eq('player_id',row.player_id).single();
        if(lookup.error)throw new Error(lookup.error.message);
        charge=lookup.data;
      } else chargedPlayers++;
    } else skippedExistingCharges++;
    if(!charge)throw new Error('Session charge could not be confirmed');
    if(charge.ledger_entry_id)continue;
    // Repair a prior interruption between charge creation, ledger creation and linking.
    const existingLedger=await supabase.from('ledger_entries').select('id,amount').eq('session_id',sessionId).eq('player_id',row.player_id).eq('type','session_used').limit(2);
    if(existingLedger.error)throw new Error(existingLedger.error.message);
    if((existingLedger.data?.length??0)>1)throw new Error('Multiple session usage ledger entries require review');
    let ledgerId=existingLedger.data?.[0]?.id;
    if(ledgerId && Number(existingLedger.data?.[0]?.amount)!==Number(charge.amount))throw new Error('Charge and ledger amounts disagree; review before retrying');
    if(!ledgerId) {
      const ledger=await supabase.from('ledger_entries').insert({season_id:session.season_id,program_id:programId,player_id:row.player_id,session_id:sessionId,type:'session_used',amount:charge.amount,sessions_count:1,description:`${sessionUsageDescription(source)}. Status: ${row.status}.`,created_by:actorId}).select('id').single();
      if(ledger.error)throw new Error(ledger.error.message);ledgerId=ledger.data.id;
    }
    const linked=await supabase.from('session_player_charges').update({ledger_entry_id:ledgerId}).eq('id',charge.id);
    if(linked.error)throw new Error(linked.error.message);
  }

  if (markSessionCompleted) {
    const { error } = await supabase.from("sessions").update({ status: "completed" }).eq("id", sessionId);
    if (error) throw new Error(error.message);
  }

  const audit=await supabase.from("audit_logs").insert({
    organization_id:session.organization_id,
    actor_id: actorId,
    action: source === "whatsapp_import" ? "session_usage_imported" : source === "manual" ? "session_usage_manual_sync" : "session_completed",
    entity_type: "sessions",
    entity_id: sessionId,
    new_data: {
      charged_players: chargedPlayers,
      skipped_existing_charges: skippedExistingCharges,
      removed_non_billable_charges: removedCharges,
      price_per_session: effectivePrice,
      confirmed_changed_to_played: shouldMarkConfirmedPlayed ? confirmedPlayerIds.length : 0
    }
  });

  if(audit.error)throw new Error(audit.error.message);

  return {
    chargedPlayers,
    skippedExistingCharges: skippedExistingCharges,
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
    .select("id,ledger_entry_id,source,waiver_amount,player_id")
    .eq("session_id", sessionId)
    .in("player_id", playerIds);
  if (error) throw new Error(error.message);
  if (!charges?.length) return 0;

  if(charges.some(charge=>Number(charge.waiver_amount??0)>0 || charge.source!=='whatsapp_import'))throw new Error('Non-billable attendance has manually adjusted charges; review before removing them');
  for(const charge of charges)if(charge.ledger_entry_id) {
    const ledger=await supabase.from('ledger_entries').select('id').eq('id',charge.ledger_entry_id).eq('session_id',sessionId).eq('player_id',charge.player_id).eq('type','session_used').maybeSingle();
    if(ledger.error || !ledger.data)throw new Error('Charge ledger mismatch; review before removing a fee');
  }
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

function sessionUsageDescription(source: "whatsapp_import" | "session_completed" | "manual") {
  if (source === "whatsapp_import") return "WhatsApp session import";
  if (source === "manual") return "Manual attendance update";
  return "Session completed";
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
