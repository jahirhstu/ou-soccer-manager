import { ImportReviewTable } from "@/components/ImportReviewTable";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "../(shell)";
import { MessageSquareText } from "lucide-react";

export default async function ImportWhatsAppPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: players }, { data: aliases }, { data: seasons }, { data: sessions }, { data: playgrounds }] = await Promise.all([
    supabase.from("players").select("*").order("display_name"),
    supabase.from("player_aliases").select("*").order("match_count", { ascending: false }),
    supabase.from("seasons").select("*").order("name"),
    supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false }),
    supabase.from("playgrounds").select("*").order("name")
  ]);
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
      <ImportReviewTable aliases={aliases ?? []} players={players ?? []} playgrounds={playgrounds ?? []} seasons={seasons ?? []} sessions={sessions ?? []} />
    </AppShell>
  );
}
