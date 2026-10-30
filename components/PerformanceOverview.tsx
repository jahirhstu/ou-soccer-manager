import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PerformanceOverview({ sessionId, seasonId }: { sessionId?: string; seasonId?: string }) {
  const db = await createSupabaseServerClient();
  let id = sessionId;
  if (!id && seasonId) {
    const { data } = await db.from("sessions").select("id").eq("season_id", seasonId).eq("status", "completed").order("session_date", { ascending: false }).limit(1).maybeSingle();
    id = data?.id;
  }
  const { data, error } = id ? await db.rpc("session_performance", { p_session_id: id }) : { data: null, error: null };
  return <section className="border-y border-line py-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="section-title">Player performance</h2><div className="flex gap-2">
      {id && <Link className="btn-secondary" href={`/sessions/${id}/performance`}>Ratings & captain voting</Link>}
      <Link className="btn-secondary" href={`/reports/performance?season=${seasonId ?? data?.session?.seasonId ?? ""}`}>Position leaderboards</Link>
    </div></div>
    {error ? <p className="mt-2 text-sm text-red-700">{error.message}</p> : <>
      <p className="mt-2 text-xs text-slate-500">{data?.session?.name ?? "No completed session"}{data ? data.closed ? " · Voting closed" : " · Provisional awards" : ""}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{["goalkeeper", "defender", "midfielder"].map(category => <div key={category}><h3 className="text-sm font-semibold capitalize">Best {category}</h3>
        {(data?.awards ?? []).filter((a: { category: string }) => a.category === category).map((a: { player_id: string; player_name: string; nominations: number }) => <p className="mt-1 text-sm" key={a.player_id}>{a.player_name} · {a.nominations} nominations</p>)}
        {!(data?.awards ?? []).some((a: { category: string }) => a.category === category) && <p className="mt-1 text-sm text-slate-500">No nominations</p>}
      </div>)}</div>
    </>}
  </section>;
}

export async function PlayerPerformanceHistory({ programId, playerId }: { programId: string; playerId: string }) {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("player_performance_history", { p_program_id: programId, p_player_id: playerId });
  return <section><h2 className="section-title">Match performance history</h2>
    {error && <p className="text-sm text-red-700">{error.message}</p>}
    {!data?.length && !error && <p className="py-3 text-sm text-slate-500">No confirmed match performances.</p>}
    {(data ?? []).map((r: { session_id: string; session_name: string; session_date: string; positions: string[]; matches_played: number; goals: number; assists: number; captain_points: number; final_rating: number }) => <Link key={r.session_id} href={`/sessions/${r.session_id}/performance`} className="flex items-center justify-between gap-3 border-b border-line py-3">
      <div><h3 className="font-semibold">{r.session_name || r.session_date}</h3><p className="text-xs capitalize text-slate-500">{r.positions?.join(" · ") || "Unknown"} · {r.matches_played} matches</p><p className="text-xs text-slate-500">{r.goals} goals · {r.assists} assists · {r.captain_points} captain points</p></div><strong className="text-lg tabular-nums">{Number(r.final_rating).toFixed(2)}</strong>
    </Link>)}
  </section>;
}
