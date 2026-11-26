import { ImportReviewTable } from "@/components/ImportReviewTable";
import { loadSignupRun, signupRunPreview } from "@/lib/signup-import-service";
import { getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";
import { AppShell } from "../(shell)";
import { MessageSquareText } from "lucide-react";

export default async function ImportWhatsAppPage({searchParams}: {searchParams?: Promise<{signupRun?:string}>}) {
  const supabase = await createSupabaseServerClient();
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
  let initialImport;
  const runId=(await searchParams)?.signupRun;
  if(runId) {
    const profile=await getCurrentProfile(),program=await getCurrentProgram();
    if(!profile?.organization_id || !program?.id || !hasPermission(profile.role,'manage_finance'))throw new Error('Import access required');
    const run=await loadSignupRun(supabase as any,runId,profile.organization_id,program.id);
    let preview,error;
    try { preview=await signupRunPreview(supabase as any,run); }
    catch(cause) { error=cause instanceof Error?cause.message:'Saved signup needs manual correction'; }
    initialImport={runId:run.id,rawText:preview?.parsed.rawText??run.source_message?.body??run.incoming_messages?.[0]?.body??'',parsed:preview?.parsed,allocation:preview?.allocation,seasonId:run.configuration.season_id,sessionId:run.session_id??'__create__',selections:run.selections??{},status:run.status,error};
  }
  const [
    { data: players },
    { data: aliases },
    { data: seasons },
    { data: sessions },
    { data: playgrounds },
    { data: playerReports },
    { data: ledgerEntries },
    { data: sessionAttendance },
    { data: sessionCharges }
  ] = await Promise.all([
    supabase.from("players").select("*").order("display_name"),
    supabase.from("player_aliases").select("*").order("match_count", { ascending: false }),
    supabase.from("seasons").select("*").order("name"),
    supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false }),
    supabase.from("playgrounds").select("*").order("name"),
    supabase.rpc("internal_scoped_player_report", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null }),
    supabase.from("ledger_entries").select("player_id,season_id,session_id,type,amount,sessions_count"),
    supabase.from("attendance").select("player_id,session_id,status"),
    supabase.from("session_player_charges").select("player_id,session_id,amount,original_amount,waiver_amount")
  ]);
  if(initialImport?.sessionId==='__create__' && initialImport.parsed?.session?.date) {
    const matching=(sessions??[]).filter(session=>session.season_id===initialImport.seasonId&&session.session_date===initialImport.parsed?.session?.date);
    if(matching.length===1)initialImport.sessionId=matching[0].id;
  }
  return (
    <AppShell>
      <div className="mb-5 flex items-start gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-emerald-50 text-pitch ring-1 ring-emerald-100">
          <MessageSquareText className="h-5 w-5" />
        </span>
        <div>
          <h1 className="page-title">WhatsApp import</h1>
          <p className="text-sm text-slate-500">Parse roster, payments, teams, scores, and attendance before confirming changes.</p>
        </div>
      </div>
      <ImportReviewTable
        initialImport={initialImport}
        aliases={aliases ?? []}
        ledgerEntries={ledgerEntries ?? []}
        playerReports={playerReports ?? []}
        players={players ?? []}
        playgrounds={playgrounds ?? []}
        seasons={seasons ?? []}
        sessionAttendance={sessionAttendance ?? []}
        sessionCharges={sessionCharges ?? []}
        sessions={sessions ?? []}
      />
    </AppShell>
  );
}
