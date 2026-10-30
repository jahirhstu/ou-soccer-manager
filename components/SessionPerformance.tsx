"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trophy } from "lucide-react";
import { updatePerformance } from "@/lib/actions/performance";
import { previousMatchPositions } from "../packages/contracts/src/performance";

const positions = ["goalkeeper", "defender", "midfielder", "forward"] as const;
import type { PerformanceData } from "../packages/contracts/src/performance";
export type { PerformanceData } from "../packages/contracts/src/performance";

export function SessionPerformance({ data }: { data: PerformanceData }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState("");
  const [matchId, setMatchId] = useState(data.matches[0]?.id ?? "");
  const [edited, setEdited] = useState<Record<string, { position: string; participated: boolean }>>({});
  const match = data.matches.find((m) => m.id === matchId);
  const teams = data.teams.filter((t) => t.id === match?.teamAId || t.id === match?.teamBId);
  const readPosition = (id: string) => edited[`${matchId}:${id}`] ?? (() => {
    const p = data.positions.find((p) => p.match_id === matchId && p.player_id === id);
    return { position: p?.position ?? "", participated: p?.participated ?? false };
  })();
  const submit = (operation: "positions" | "vote" | "close", payload: Record<string, unknown>) => start(async () => {
    setMessage("");
    try {
      const response = await updatePerformance(data.session.id, operation, payload);
      setMessage(response.error ?? "Saved.");
      if (!response.error) router.refresh();
    } catch { setMessage("Could not save. Please retry."); }
  });
  return <div className="grid gap-5">
    <div role="status" className="text-sm font-medium">{busy ? "Saving…" : message}</div>
    <section className="border-b border-line pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">Weekly awards</h2>
        <span className="text-sm text-slate-500">{data.closed ? "Voting closed" : "Provisional · voting open"} · {data.votes.length} / {data.teams.length * 3} nominations</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{positions.slice(0, 3).map((category) => <div key={category} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center gap-2 font-semibold capitalize"><Trophy className="h-4 w-4" />Best {category}</div>
        {data.awards.filter((a) => a.category === category).map((a) => <p key={a.player_id} className="mt-2 text-sm">{a.player_name} <span className="text-emerald-700">· {a.nominations} nomination{a.nominations === 1 ? "" : "s"}</span></p>)}
        {!data.awards.some((a) => a.category === category) && <p className="mt-2 text-sm text-slate-500">No nominations</p>}
      </div>)}</div>
      {data.canClose && <button disabled={busy} className="btn-secondary mt-3" onClick={() => {
        if (window.confirm(data.closed ? "Reopen voting for captain edits?" : "Close voting? Incomplete ballots will remain incomplete.")) submit("close", { closed: !data.closed });
      }}>{data.closed ? "Reopen voting" : "Close voting"}</button>}
    </section>
    {data.canManage && <section className="border-b border-line pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="section-title">Match positions & participation</h2>
        <label className="flex items-center gap-2 text-sm">Match<select className="input" value={matchId} onChange={(e) => setMatchId(e.target.value)}>{data.matches.map((m) => <option key={m.id} value={m.id}>G{m.number} · {m.status}</option>)}</select></label>
      </div>
      {data.canManage && Object.keys(previousMatchPositions(data, matchId)).length > 0 && <button className="btn-secondary mt-3" disabled={busy} onClick={() => setEdited(old => ({ ...old, ...previousMatchPositions(data, matchId) }))}>Copy previous match positions</button>}
      <div className="mt-3 grid gap-4 md:grid-cols-2">{teams.map((team) => <div key={team.id}>
        <h3 className="border-b border-line py-2 font-semibold">{team.name}</h3>
        {team.players.map((player) => {
          const value = readPosition(player.id);
          const update = (change: Partial<typeof value>) => setEdited((old) => ({ ...old, [`${matchId}:${player.id}`]: { ...value, ...change } }));
          return <div key={player.id} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(100px,140px)] items-center gap-2 border-b border-line py-2 text-sm">
            <span className="break-words font-medium">{player.name}</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={value.participated} onChange={(e) => update({ participated: e.target.checked })} />Played</label>
            <select aria-label={`${player.name} position`} className="input min-w-0 text-sm" value={value.position} onChange={(e) => update({ position: e.target.value })}>
              <option value="">Unknown</option>{positions.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>;
        })}
      </div>)}</div>
      <button disabled={busy || !match} className="btn-primary mt-3" onClick={() => submit("positions", { matchId, players: teams.flatMap((t) => t.players.map((p) => ({ playerId: p.id, ...readPosition(p.id) }))) })}><Check className="h-4 w-4" />Confirm match participation</button>
    </section>}
    {data.session.status === "completed" && !data.closed && data.teams.filter((t) => t.canVote).map((team) => <section key={team.id} className="border-b border-line pb-5">
      <h2 className="section-title">Captain nominations · {team.name}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{positions.slice(0, 3).map((category) => {
        const eligible = [...new Map(data.details.filter((p) => p.position === category && !team.players.some((own) => own.id === p.player_id)).map((p) => [p.player_id, p])).values()];
        return <form key={category} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit("vote", { teamId: team.id, category, playerId: f.get("player") }); }}>
          <label className="grid gap-2 text-sm font-semibold capitalize">Best {category}<select name="player" required className="input" defaultValue={data.votes.find((v) => v.captain_team_id === team.id && v.category === category)?.player_id ?? ""}>
            <option value="">Select nominee</option>{eligible.map((p) => <option value={p.player_id} key={p.player_id}>{p.player_name}</option>)}
          </select></label><button disabled={busy || !eligible.length} className="btn-secondary mt-2">Save nomination</button>
        </form>;
      })}</div>
    </section>)}
    <section><h2 className="section-title">Session ratings</h2>
      {!data.results.length && <p className="py-4 text-sm text-slate-500">No confirmed participation in played matches yet.</p>}
      <div className="mt-3 divide-y divide-slate-200">{data.results.map((r) => <details key={r.player_id} className="py-3">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2"><div><span className="font-semibold">{r.player_name}</span><p className="text-xs capitalize text-slate-500">{r.positions?.join(" · ") || "Unknown position"} · {r.matches_played} matches{r.incomplete ? " · incomplete data" : ""}</p></div>
          <div className="text-right"><strong className="text-xl tabular-nums text-emerald-800">{Number(r.final_rating).toFixed(2)}</strong><p className="text-xs text-slate-500">Match {Number(r.match_points).toFixed(2)}/40 + captain {r.captain_points}/60</p></div>
        </summary>
        {data.details.filter((d) => d.player_id === r.player_id).map((d) => <div className="mt-2 rounded border border-line bg-slate-50 p-3 text-sm" key={d.match_number}>
          <strong>G{d.match_number} · {d.position ?? "Unknown"} · {d.breakdown.rating ?? "Unrated"}/10</strong>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">{Object.entries(d.breakdown).filter(([key]) => key !== "version" && key !== "rating").map(([key, value]) => <span key={key} className="capitalize">{key}: {value}</span>)}</div>
          {d.position === "goalkeeper" && <p className="mt-1 text-xs">Conceded: {d.keeper_conceded ?? "Unknown"}{d.clean_sheet ? " · Clean sheet" : ""}</p>}
        </div>)}
      </details>)}</div>
    </section>
  </div>;
}
