import { AppShell } from "../../../(shell)";
import { SessionNominations } from "@/components/SessionNominations";
import type { PerformanceData } from "@/packages/contracts/src/performance";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SessionNominationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("session_performance", { p_session_id: id });
  return <AppShell><div className="grid gap-5">
    <header><h1 className="page-title">Nomination</h1><p className="text-sm text-slate-500">{data?.session?.name}</p></header>
    {error ? <p role="alert" className="text-red-700">{error.message}</p> : <SessionNominations data={data as PerformanceData} />}
  </div></AppShell>;
}
