"use client";

import type { PerformanceData } from "../packages/contracts/src/performance";
export type { PerformanceData } from "../packages/contracts/src/performance";

export function SessionPerformance({ data }: { data: PerformanceData }) {
  return <div className="grid gap-5">
    <section><h2 className="section-title">Session ratings</h2>
      {!data.results.length && <p className="py-4 text-sm text-slate-500">No player performance is available for this session yet.</p>}
      <div className="mt-3 divide-y divide-slate-200">{data.results.map((r) => <details key={r.player_id} className="py-3">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2"><div><span className="font-semibold">{r.player_name}</span><p className="text-xs capitalize text-slate-500">{r.positions?.join(" · ") || "Unknown position"} · {r.matches_played} matches{r.incomplete ? " · incomplete data" : ""}</p></div>
          <div className="text-right"><strong className="text-xl tabular-nums text-emerald-800">{Number(r.final_rating).toFixed(2)}</strong><p className="text-xs text-slate-500">Match {Number(r.match_points).toFixed(2)}/40 + nominations {Number(r.nomination_points ?? r.captain_points).toFixed(2)}/60</p></div>
        </summary>
        {data.details.filter((d) => d.player_id === r.player_id).map((d) => <div className="mt-2 rounded border border-line bg-slate-50 p-3 text-sm" key={d.match_number}>
          <strong>G{d.match_number} · {d.positions?.join(" · ") ?? d.position ?? "Unknown"} · {d.breakdown.rating == null ? "Unrated" : Number(d.breakdown.rating).toFixed(2)}/10</strong>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">{Object.entries(d.breakdown).filter(([key]) => key !== "version" && key !== "rating").map(([key, value]) => <span key={key} className="capitalize">{key}: {value}</span>)}</div>
          {d.positions?.includes("goalkeeper") && <p className="mt-1 text-xs">Conceded: {d.keeper_conceded ?? "Unknown"}{d.clean_sheet ? " · Clean sheet" : ""}{d.keeper_attribution_incomplete ? " · Provisional: goalkeeper assignments are incomplete" : ""}</p>}
        </div>)}
      </details>)}</div>
    </section>
  </div>;
}
