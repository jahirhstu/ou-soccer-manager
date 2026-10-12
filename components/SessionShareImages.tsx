import type { CSSProperties, ReactNode } from "react";
import { Crown, Medal, Trophy } from "lucide-react";

export type ShareSession = { name: string; date?: string | null; location?: string | null };
export type ShareStanding = {
  teamId: string; teamName: string; rank: number; played: number; wins: number; draws: number; losses: number;
  goalsFor: number; goalsAgainst: number; goalDifference: number; awayGoals: number; points: number;
};
export type SharePlayerTotal = { playerName: string; teamNames: string; total: number };
export type ShareResult = {
  matchNumber: number; teamAName: string; teamBName: string; teamAScore: number; teamBScore: number; homeAway: string;
  goals: { scorerName: string | null; assistName: string | null; goalCount: number | string | null; goalType?: string | null }[];
};
export type ShareTeam = { id?: string; name: string; captainPlayerId?: string | null; players: { id: string; name: string }[] };

const ink = "#14201b";
const green = "#0f7a4a";
const muted = "#52635a";
const border = "#dce5df";
const grid = (columns: number): CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 12 });
const rowStyle: CSSProperties = { borderBottom: `1px solid ${border}`, padding: "10px 0", breakInside: "avoid" };
const titleStyle: CSSProperties = { margin: 0, fontSize: 28, lineHeight: 1.2, fontWeight: 700, color: green, paddingBottom: 8 };

function Frame({ session, title, children }: { session: ShareSession; title: string; children: ReactNode }) {
  return (
    <div style={{ width: 640, boxSizing: "border-box", padding: 16, background: "#ffffff", color: ink, fontFamily: "Arial, sans-serif", fontSize: 30, lineHeight: 1.2, letterSpacing: 0, overflowWrap: "anywhere" }}>
      <header data-share-header style={{ borderBottom: `3px solid ${green}`, paddingBottom: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 32, fontWeight: 700 }}>{session.name}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: green, marginTop: 4 }}>{title}</div>
        {session.date || session.location ? <div style={{ fontSize: 24, color: muted, marginTop: 6 }}>{[session.date, session.location].filter(Boolean).join(" | ")}</div> : null}
      </header>
      {children}
    </div>
  );
}

function Section({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return <section data-share-section style={{ marginTop: 12 }}><div data-share-section-header>{heading}</div><div data-share-rows>{children}</div></section>;
}

export function StandingsShareImage({ session, standings }: { session: ShareSession; standings: ShareStanding[] }) {
  const signed = (value: number) => value > 0 ? `+${value}` : String(value);
  return (
    <Frame session={session} title="Podium & Standings">
      <Section heading={<h2 style={titleStyle}>Podium</h2>}>
        <div style={grid(Math.max(1, Math.min(3, standings.length)))}>
          {standings.slice(0, 3).map((team, index) => {
            const Icon = index === 0 ? Trophy : Medal;
            return <div key={team.teamId} style={{ padding: 10, borderRadius: 6, background: ["#fffbeb", "#f1f5f9", "#ecfdf5"][index] }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: ["#a16207", "#475569", green][index], fontSize: 22, fontWeight: 700 }}><Icon size={24} />{["Winner", "Second", "Third"][index]}</div>
              <div style={{ fontSize: 28, fontWeight: 700, margin: "6px 0" }}>{team.teamName}</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{team.points}<span style={{ fontSize: 22, fontWeight: 400 }}> pts</span></div>
            </div>;
          })}
          {!standings.length ? <div style={{ fontSize: 28 }}>No standings yet.</div> : null}
        </div>
      </Section>
      <Section heading={<h2 style={titleStyle}>Standings</h2>}>
        {standings.map((team) => <div key={team.teamId} style={rowStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr) auto", gap: 8, alignItems: "baseline", fontWeight: 700 }}><span style={{ color: green }}>{team.rank}</span><span>{team.teamName}</span><span>{team.points}<span style={{ fontSize: 22, fontWeight: 400 }}> pts</span></span></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", marginTop: 6, fontSize: 26 }}><span>P {team.played}</span><span>W {team.wins}</span><span>D {team.draws}</span><span>L {team.losses}</span></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 4, fontSize: 24, color: muted }}><span>GF {team.goalsFor}</span><span>GA {team.goalsAgainst}</span><span>GD {signed(team.goalDifference)}</span><span>AG {team.awayGoals}</span></div>
        </div>)}
        {!standings.length ? <div style={rowStyle}>No standings yet.</div> : null}
      </Section>
    </Frame>
  );
}

function PlayerCell({ player, empty }: { player?: SharePlayerTotal; empty?: string }) {
  return <div style={{ ...rowStyle, padding: "6px 0", minWidth: 0 }}>
    {player ? <><div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, fontWeight: 700 }}><span>{player.playerName}</span><span style={{ color: green }}>{player.total}</span></div>{player.teamNames ? <div style={{ color: muted, fontSize: 24, marginTop: 3 }}>{player.teamNames}</div> : null}</> : empty ? <div style={{ color: muted, fontSize: 26 }}>{empty}</div> : null}
  </div>;
}

export function PlayersShareImage({ session, scorers, assists }: { session: ShareSession; scorers: SharePlayerTotal[]; assists: SharePlayerTotal[] }) {
  const uneven = Math.abs(scorers.length - assists.length) >= 2;
  return <Frame session={session} title="Scorers & Assists">
    {uneven ? [{ title: "Scorers", rows: scorers }, { title: "Assists", rows: assists }].map(({ title, rows }) => (
      <Section key={title} heading={<h2 style={titleStyle}>{title}</h2>}>
        {Array.from({ length: Math.max(1, Math.ceil(rows.length / 2)) }, (_, index) => <div key={index} style={grid(2)}><PlayerCell player={rows[index * 2]} empty={index === 0 ? "None recorded." : undefined} /><PlayerCell player={rows[index * 2 + 1]} /></div>)}
      </Section>
    )) : <Section heading={<div style={grid(2)}><h2 style={titleStyle}>Scorers</h2><h2 style={titleStyle}>Assists</h2></div>}>
      {Array.from({ length: Math.max(1, scorers.length, assists.length) }, (_, index) => <div key={index} style={grid(2)}><PlayerCell player={scorers[index]} empty={index === 0 ? "No goals yet." : undefined} /><PlayerCell player={assists[index]} empty={index === 0 ? "No assists yet." : undefined} /></div>)}
    </Section>}
  </Frame>;
}

export function ResultsShareImage({ session, matches }: { session: ShareSession; matches: ShareResult[] }) {
  return <Frame session={session} title="Match Results">
    {matches.map((match) => <Section key={match.matchNumber} heading={<div style={{ borderTop: `2px solid ${border}`, paddingTop: 8 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: green }}>Game {match.matchNumber}</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: 12, fontWeight: 700, marginTop: 4 }}><span>{match.teamAName}</span><span style={{ fontSize: 36, whiteSpace: "nowrap" }}>{match.teamAScore}-{match.teamBScore}</span><span style={{ textAlign: "right" }}>{match.teamBName}</span></div>
      <div style={{ fontSize: 24, color: muted, margin: "4px 0" }}>{match.homeAway}</div>
    </div>}>
      {match.goals.map((goal, index) => <div key={index} style={{ ...rowStyle, fontSize: 28 }}>
        <div>{goal.goalType === "own_goal" ? "Own goal: " : "Goal: "}<strong>{goal.scorerName || "Unknown"}</strong>{Number(goal.goalCount ?? 1) > 1 ? <strong> x{goal.goalCount}</strong> : null}</div>
        {goal.assistName ? <div style={{ fontSize: 24, color: muted, marginTop: 3 }}>Assist: {goal.assistName}</div> : null}
      </div>)}
      {!match.goals.length ? <div style={{ fontSize: 24, color: muted, paddingTop: 4 }}>No goal details recorded.</div> : null}
    </Section>)}
    {!matches.length ? <Section heading={null}><div>No match results yet.</div></Section> : null}
  </Frame>;
}

export function TeamsShareImage({ session, teams }: { session: ShareSession; teams: ShareTeam[] }) {
  const columns = teams.length === 3 ? 3 : 2;
  const groups = Array.from({ length: Math.ceil(teams.length / columns) }, (_, index) => teams.slice(index * columns, (index + 1) * columns));
  return <Frame session={session} title="Teams">
    {groups.map((group, groupIndex) => {
      const players = group.map((team) => [...team.players].sort((a, b) => Number(b.id === team.captainPlayerId) - Number(a.id === team.captainPlayerId)));
      return <Section key={groupIndex} heading={<div style={grid(group.length)}>{group.map((team, index) => <div key={team.id || index} style={{ padding: "8px 4px", background: ["#ecfdf5", "#eff6ff", "#fff7ed"][index], borderRadius: 6, fontSize: 30, fontWeight: 700 }}>{team.name}</div>)}</div>}>
        {Array.from({ length: Math.max(1, ...players.map((rows) => rows.length)) }, (_, rowIndex) => <div key={rowIndex} style={grid(group.length)}>
          {group.map((team, column) => {
            const player = players[column][rowIndex];
            return <div key={team.id || column} style={{ ...rowStyle, fontSize: 30, minWidth: 0 }}>
              {player ? <><span>{player.name}</span>{player.id === team.captainPlayerId ? <Crown aria-label="Captain" size={24} style={{ display: "inline-block", marginLeft: 4, color: "#a16207", verticalAlign: "baseline" }} /> : null}</> : null}
            </div>;
          })}
        </div>)}
      </Section>;
    })}
    {!teams.length ? <Section heading={null}><div>No saved teams yet.</div></Section> : null}
  </Frame>;
}
