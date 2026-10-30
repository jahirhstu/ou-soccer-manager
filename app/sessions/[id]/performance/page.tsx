import Link from "next/link";
import { AppShell } from "../../../(shell)";
import { SessionPerformance, type PerformanceData } from "@/components/SessionPerformance";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PerformancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("session_performance", { p_session_id: id });
  return <AppShell><div className="grid gap-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="page-title">Player performance</h1><p className="text-sm text-slate-500">{data?.session?.name}</p></div>
      <div className="flex gap-2"><Link className="btn-secondary" href={`/sessions/${id}`}>Session</Link><Link className="btn-secondary" href={`/reports/performance?season=${data?.session?.seasonId ?? ""}`}>Season rankings</Link></div>
    </header>
    {error ? <p role="alert" className="text-red-700">{error.message}</p> : <SessionPerformance data={data as PerformanceData} />}
  </div></AppShell>;
}
