import { AppShell } from "../../(shell)";
import { createSupabaseServerClient, getCurrentProgram } from "@/lib/supabase/server";

export default async function PerformanceReport({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const query = await searchParams;
  const program = await getCurrentProgram();
  const db = await createSupabaseServerClient();
  const { data: seasons } = await db.from("seasons").select("id,name").eq("program_id", program?.id ?? "00000000-0000-0000-0000-000000000000").order("start_date", { ascending: false });
  const season = seasons?.find((s) => s.id === query.season) ?? seasons?.[0];
  const { data, error } = season ? await db.rpc("season_performance", { p_season_id: season.id }) : { data: [], error: null };
  const rows = (data ?? []) as { player_id: string; player_name: string; position: string; matches_played: number; sessions_played: number; average_match_rating: number; nominations: number }[];
  return <AppShell><div className="grid gap-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="page-title">Position leaderboards</h1>
      <form className="flex gap-2"><select aria-label="Season" className="input" name="season" defaultValue={season?.id}>{seasons?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button className="btn-secondary">Apply</button></form></header>
    {error && <p role="alert" className="text-red-700">{error.message}</p>}
    {['goalkeeper', 'defender', 'midfielder', 'forward'].map((position) => <section key={position} className="border-b border-line pb-4">
      <h2 className="section-title capitalize">{position}s</h2>
      {!rows.some((r) => r.position === position) && <p className="py-3 text-sm text-slate-500">No confirmed performances.</p>}
      {rows.filter((r) => r.position === position).map((r, i) => <div className="flex items-center justify-between gap-3 border-b border-line py-3" key={r.player_id}>
        <div><span className="mr-2 text-slate-400">{i + 1}</span><strong>{r.player_name}</strong><p className="text-xs text-slate-500">{r.matches_played} matches · {r.sessions_played} sessions · {r.nominations} nominations</p></div>
        <strong className="text-lg tabular-nums text-emerald-800">{Number(r.average_match_rating).toFixed(2)}<span className="text-xs text-slate-500"> / 10</span></strong>
      </div>)}
    </section>)}
  </div></AppShell>;
}
