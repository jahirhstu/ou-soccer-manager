"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { updatePerformance } from "@/lib/actions/performance";
import { matchPositionEntries } from "@/lib/performance-position";
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
  const positionRow = (id: string) => data.positions.find((p) => p.match_id === matchId && p.player_id === id);
  const readPosition = (id: string) => edited[`${matchId}:${id}`] ?? {
    position: positionRow(id)?.goalkeeper_assigned ? "goalkeeper" : positionRow(id)?.position ?? "",
    participated: positionRow(id)?.participated ?? true
  };
  const matchEdits = Object.entries(edited).filter(([key]) => key.startsWith(`${matchId}:`));
  const positionChanges = matchPositionEntries(matchEdits.map(([key, value]) => {
    const playerId = key.slice(matchId.length + 1);
    const row = positionRow(playerId);
    return { playerId, ...value, resolvedPosition: row?.position ?? null, goalkeeperAssigned: row?.goalkeeper_assigned };
  }));
  const submit = (operation: "positions", payload: Record<string, unknown>) => start(async () => {
    setMessage("");
    try {
      const response = await updatePerformance(data.session.id, operation, payload);
      setMessage(response.error ?? "Saved.");
      if (!response.error) {
        setEdited((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${matchId}:`))));
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save. Please retry.");
    }
  });
  return <div className="grid gap-5">
    <div role="status" className="text-sm font-medium">{busy ? "Saving…" : message}</div>
    {data.canManage && <section className="border-b border-line pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="section-title">Match positions & participation</h2>
        <label className="flex items-center gap-2 text-sm">Match<select className="input" value={matchId} onChange={(e) => setMatchId(e.target.value)}>{data.matches.map((m) => <option key={m.id} value={m.id}>{m.teamAName} vs {m.teamBName} · Match {m.number}</option>)}</select></label>
      </div>
      {data.canManage && Object.keys(previousMatchPositions(data, matchId)).length > 0 && <button className="btn-secondary mt-3" disabled={busy} onClick={() => setEdited(old => ({ ...old, ...previousMatchPositions(data, matchId) }))}>Copy previous match positions</button>}
      <div className="mt-3 grid gap-4 md:grid-cols-2">{teams.map((team) => <div key={team.id}>
        <h3 className="border-b border-line py-2 font-semibold">{team.name}</h3>
        {team.players.map((player) => {
          const value = readPosition(player.id);
          const row = positionRow(player.id);
          const resolvedPosition = row?.position;
          const goalkeeperAssigned = row?.goalkeeper_assigned ?? false;
          const update = (position: string) => setEdited((old) => {
            const next = { ...old };
            const key = `${matchId}:${player.id}`;
            if (position === resolvedPosition && !goalkeeperAssigned) delete next[key];
            else next[key] = { ...value, position };
            return next;
          });
          return <div key={player.id} className="grid grid-cols-[minmax(0,1fr)_minmax(100px,140px)] items-center gap-2 border-b border-line py-2 text-sm">
            <div className="grid gap-1">
              <span className="break-words font-medium">{player.name}</span>
              {goalkeeperAssigned && <span className="text-xs text-amber-800" role="note">This player is recorded as the goalkeeper who conceded a goal. Keep their position as Goalkeeper; change the goal assignment before changing this position.</span>}
            </div>
            <select aria-label={`${player.name} position`} className="input min-w-0 text-sm" value={value.position} onChange={(e) => update(e.target.value)}>
              {positions.map((p) => <option key={p} value={p} disabled={goalkeeperAssigned && p !== "goalkeeper"}>{capitalize(p)}{resolvedPosition === p ? " (Resolved)" : ""}</option>)}
            </select>
          </div>;
        })}
      </div>)}</div>
      <button disabled={busy || !match || !positionChanges.length} className="btn-primary mt-3" onClick={() => submit("positions", { matchId, players: positionChanges })}><Check className="h-4 w-4" />Save match positions</button>
    </section>}
    <section><h2 className="section-title">Session ratings</h2>
      {!data.results.length && <p className="py-4 text-sm text-slate-500">No confirmed participation in played matches yet.</p>}
      <div className="mt-3 divide-y divide-slate-200">{data.results.map((r) => <details key={r.player_id} className="py-3">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2"><div><span className="font-semibold">{r.player_name}</span><p className="text-xs capitalize text-slate-500">{r.positions?.join(" · ") || "Unknown position"} · {r.matches_played} matches{r.incomplete ? " · incomplete data" : ""}</p></div>
          <div className="text-right"><strong className="text-xl tabular-nums text-emerald-800">{Number(r.final_rating).toFixed(2)}</strong><p className="text-xs text-slate-500">Match {Number(r.match_points).toFixed(2)}/40 + nominations {Number(r.nomination_points ?? r.captain_points).toFixed(2)}/60</p></div>
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

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
