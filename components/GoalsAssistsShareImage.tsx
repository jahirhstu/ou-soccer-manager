import type { CSSProperties } from "react";

export type GoalsAssistsRow = {
  player_name: string | null;
  season_id: string | null;
  season_name: string | null;
  goals: number | null;
  assists: number | null;
  sessions_count: number | null;
  games_count: number | null;
  goals_per_game: number | string | null;
  assists_per_game: number | string | null;
  goal_contributions_per_game: number | string | null;
};

export function GoalsAssistsShareImage({ rows, seasonLabel, sessionLabel, playerFilter }: {
  rows: GoalsAssistsRow[]; seasonLabel: string; sessionLabel: string; playerFilter?: string;
}) {
  const green = "#08784c", border = "#dce5df", muted = "#52635a";
  const columns: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0,1fr) 84px 84px", gap: 8, alignItems: "center" };
  return <div style={{ width: 640, boxSizing: "border-box", padding: 16, background: "white", color: "#14201b", fontFamily: "Arial, sans-serif", fontSize: 30, lineHeight: 1.2, letterSpacing: 0, overflowWrap: "anywhere" }}>
    <header style={{ borderBottom: `3px solid ${green}`, paddingBottom: 10, marginBottom: 12 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: muted }}>Report Gallery</div>
      <h1 style={{ margin: "4px 0 8px", fontSize: 32, fontWeight: 700 }}>Goals &amp; Assists</h1>
      <div style={{ fontSize: 20, color: muted }}><strong>Season:</strong> {seasonLabel}</div>
      <div style={{ fontSize: 20, color: muted, marginTop: 3 }}><strong>Session:</strong> {sessionLabel}</div>
      {playerFilter ? <div style={{ fontSize: 20, color: muted, marginTop: 3 }}><strong>Player filter:</strong> {playerFilter}</div> : null}
    </header>
    <div style={{ border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ ...columns, background: green, color: "white", padding: "10px 12px", fontSize: 20, fontWeight: 700 }}><span>Player / Season</span><span style={{ textAlign: "center" }}>Goals</span><span style={{ textAlign: "center" }}>Assists</span></div>
      {rows.map((row, index) => <div key={`${row.season_id}:${row.player_name}:${index}`} style={{ padding: "10px 12px", borderTop: `1px solid ${border}`, background: index % 2 ? "#f6f8f7" : "white" }}>
        <div style={columns}>
          <div><div style={{ fontWeight: 700 }}>{row.player_name ?? "-"}</div><div style={{ marginTop: 3, fontSize: 20, color: muted }}>{row.season_name ?? "-"}</div></div>
          {[row.goals ?? 0, row.assists ?? 0].map((count, column) => <div key={column} style={{ borderLeft: `1px solid ${border}`, textAlign: "center", fontSize: 34, fontWeight: 700, color: column ? "#2067a1" : green }}>{count}</div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6, marginTop: 10, textAlign: "center" }}>
          {[["Sessions", row.sessions_count], ["Games", row.games_count], ["Goals / game", row.goals_per_game], ["Assists / game", row.assists_per_game], ["G+A / game", row.goal_contributions_per_game]].map(([label, value]) => <div key={String(label)}><div style={{ fontSize: 16, color: muted }}>{label}</div><div style={{ marginTop: 3, fontSize: 24, fontWeight: 700 }}>{value ?? 0}</div></div>)}
        </div>
      </div>)}
      {!rows.length ? <div style={{ padding: 12, fontSize: 24 }}>No goals or assists match this filter.</div> : null}
    </div>
  </div>;
}
