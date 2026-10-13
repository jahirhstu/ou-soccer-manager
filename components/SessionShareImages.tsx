import type { CSSProperties, ReactNode } from "react";
import { Crown, Medal, Trophy } from "lucide-react";
import type { PlayerContribution } from "@/lib/player-contributions";

export type ShareSession = { name: string; date?: string | null; location?: string | null };
export type ShareStanding = { teamId: string; teamName: string; rank: number; played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; goalDifference: number; awayGoals: number; points: number };
export type ShareResult = { matchNumber: number; teamAName: string; teamBName: string; teamAScore: number; teamBScore: number; homeAway: string; goals: { scorerName: string | null; assistName: string | null; goalCount: number | string | null; goalType?: string | null }[] };
export type ShareTeam = { id?: string; name: string; captainPlayerId?: string | null; players: { id: string; name: string }[] };

const ink = "#14201b", green = "#08784c", muted = "#52635a", border = "#dce5df";
const grid = (columns: number): CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 12 });
const box: CSSProperties = { border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" };

function Frame({ session, title, children }: { session: ShareSession; title: string; children: ReactNode }) {
  return <div style={{ width: 640, boxSizing: "border-box", padding: 16, background: "#ffffff", color: ink, fontFamily: "Arial, sans-serif", fontSize: 30, lineHeight: 1.2, letterSpacing: 0, overflowWrap: "anywhere" }}>
    <header style={{ borderBottom: `3px solid ${green}`, paddingBottom: 10, marginBottom: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: muted }}>{session.name}</div>
      <div style={{ fontSize: 32, fontWeight: 700, marginTop: 3 }}>{title}</div>
      {session.date || session.location ? <div style={{ fontSize: 20, color: muted, marginTop: 5 }}>{[session.date, session.location].filter(Boolean).join(" | ")}</div> : null}
    </header>{children}
  </div>;
}

export function StandingsShareImage({ session, standings }: { session: ShareSession; standings: ShareStanding[] }) {
  const signed = (n: number) => n > 0 ? `+${n}` : String(n);
  return <Frame session={session} title="Podium & Standings">
    <div style={grid(Math.max(1, Math.min(3, standings.length)))}>
      {standings.slice(0, 3).map((team, index) => {
        const Icon = index === 0 ? Trophy : Medal;
        const color = ["#996608", "#526074", "#985a35"][index];
        return <div key={team.teamId} style={{ ...box, padding: 10, borderColor: ["#e9c65f", "#cbd5e1", "#dcb89f"][index], background: ["#fff8df", "#f1f5f9", "#fff0e7"][index] }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color, fontSize: 20, fontWeight: 700 }}><Icon size={22} />{["Winner", "Second", "Third"][index]}</div>
          <div style={{ fontSize: 26, fontWeight: 700, margin: "8px 0" }}>{team.teamName}</div>
          <div style={{ fontSize: 34, fontWeight: 700, color }}>{team.points}<span style={{ fontSize: 20 }}> pts</span></div>
        </div>;
      })}
    </div>
    <h2 style={{ margin: "16px 0 8px", fontSize: 24, color: green }}>Standings</h2>
    <div style={box}>{standings.map((team, index) => <div key={team.teamId} style={{ padding: "10px 12px", borderTop: index ? `1px solid ${border}` : undefined, background: index % 2 ? "#f6f8f7" : "white" }}>
      <div style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto", gap: 8, alignItems: "center", fontWeight: 700 }}><span style={{ color: green }}>{team.rank}</span><span>{team.teamName}</span><span style={{ color: green }}>{team.points}<span style={{ fontSize: 18 }}> pts</span></span></div>
      <div style={{ ...grid(8), gap: 4, marginTop: 8, textAlign: "center" }}>{[["P", team.played], ["W", team.wins], ["D", team.draws], ["L", team.losses], ["GF", team.goalsFor], ["GA", team.goalsAgainst], ["GD", signed(team.goalDifference)], ["AG", team.awayGoals]].map(([label, value]) => <div key={label} aria-label={`${label} ${value}`} style={{ borderLeft: label === "GF" ? `1px solid ${border}` : undefined }}><div style={{ fontSize: 16, color: muted }}>{label}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div></div>)}</div>
    </div>)}{!standings.length ? <div style={{ padding: 12 }}>No standings yet.</div> : null}</div>
  </Frame>;
}

export function PlayersShareImage({ session, players }: { session: ShareSession; players: PlayerContribution[] }) {
  const columns: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0,1fr) 84px 84px", gap: 8, alignItems: "center" };
  return <Frame session={session} title="Scorers & Assists"><div style={box}>
    <div style={{ ...columns, padding: "10px 12px", background: green, color: "white", fontSize: 20, fontWeight: 700 }}><span>Player / Team</span><span style={{ textAlign: "center" }}>Goals</span><span style={{ textAlign: "center" }}>Assists</span></div>
    {players.map((player, index) => <div key={player.playerName} style={{ ...columns, padding: "10px 12px", borderTop: `1px solid ${border}`, background: index % 2 ? "#f6f8f7" : "white" }}>
      <div><div style={{ fontWeight: 700 }}>{player.playerName}</div><div style={{ fontSize: 20, color: muted, marginTop: 3 }}>{player.teamNames}</div></div>
      {[player.goals, player.assists].map((value, column) => <div key={column} style={{ textAlign: "center", fontSize: 34, fontWeight: 700, color: value ? (column ? "#2067a1" : green) : "#76847c", borderLeft: `1px solid ${border}` }}>{value}</div>)}
    </div>)}{!players.length ? <div style={{ padding: 12 }}>No goals or assists recorded yet.</div> : null}
  </div></Frame>;
}

export function ResultsShareImage({ session, matches }: { session: ShareSession; matches: ShareResult[] }) {
  return <Frame session={session} title="Match Results">{[...matches].sort((a, b) => a.matchNumber - b.matchNumber).map((match) => <section key={match.matchNumber} style={{ ...box, marginTop: 10 }}>
    <div style={{ background: "#f0f6f3", padding: "8px 12px" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: green }}>Game {match.matchNumber}</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "center", gap: 10, fontSize: 28, fontWeight: 700, marginTop: 3 }}><span>{match.teamAName}</span><span style={{ fontSize: 36, whiteSpace: "nowrap", color: green }}>{match.teamAScore}-{match.teamBScore}</span><span style={{ textAlign: "right" }}>{match.teamBName}</span></div>
      <div style={{ fontSize: 18, color: muted, marginTop: 4 }}>{match.homeAway}</div>
    </div>
    <div style={{ padding: "4px 12px" }}>{match.goals.map((goal, index) => <div key={index} style={{ padding: "6px 0", borderTop: index ? `1px solid ${border}` : undefined, fontSize: 24 }}>
      <strong>{goal.scorerName || "Unknown"}</strong>{Number(goal.goalCount ?? 1) > 1 ? <strong> x{goal.goalCount}</strong> : null}
      {goal.goalType === "own_goal" ? <span style={{ color: "#a33b39", fontSize: 20 }}> (Own goal)</span> : null}
      {goal.assistName ? <span style={{ color: muted, fontSize: 20 }}> | Assist: {goal.assistName}</span> : null}
    </div>)}{!match.goals.length ? <div style={{ fontSize: 20, color: muted, padding: "4px 0" }}>No goal details recorded.</div> : null}</div>
  </section>)}{!matches.length ? <div>No match results yet.</div> : null}</Frame>;
}

export function TeamsShareImage({ session, teams }: { session: ShareSession; teams: ShareTeam[] }) {
  const columns = Math.max(1, teams.length === 3 ? 3 : Math.min(2, teams.length));
  return <Frame session={session} title="Teams"><div style={{ ...grid(columns), alignItems: "start" }}>{teams.map((team, index) => <section key={team.id || index} style={box}>
    <div style={{ padding: "10px 8px", background: ["#e5f4eb", "#e8f1fb", "#fff1df"][index % 3], borderBottom: `1px solid ${border}` }}><div style={{ fontSize: 26, fontWeight: 700 }}>{team.name}</div><div style={{ fontSize: 18, color: muted, marginTop: 4 }}>{team.players.length} players</div></div>
    <div style={{ display: "grid", gap: 6, padding: 6 }}>{[...team.players].sort((a, b) => Number(b.id === team.captainPlayerId) - Number(a.id === team.captainPlayerId)).map((player) => <div key={player.id} style={{ ...box, padding: "8px 6px", fontSize: columns === 3 ? 26 : 30, background: player.id === team.captainPlayerId ? "#fffbea" : "white" }}>
      <span>{player.name}</span>{player.id === team.captainPlayerId ? <Crown aria-label="Captain" size={20} style={{ display: "inline-block", marginLeft: 4, color: "#996608", verticalAlign: "baseline" }} /> : null}
    </div>)}</div>
  </section>)}</div>{!teams.length ? <div>No saved teams yet.</div> : null}</Frame>;
}
