"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { saveMiniGameScores } from "@/lib/actions/session-management";

export type TeamOption = {
  id: string;
  name: string;
  players: Array<{ id: string; name: string }>;
};

export type MatchInput = {
  key: string;
  matchNumber: number;
  teamAId: string;
  teamBId: string;
  awayTeamId?: string;
  goals: GoalInput[];
};

type GoalInput = {
  key: string;
  scorerId: string;
  assistPlayerId: string;
  goalType: "goal" | "own_goal";
  goalCount: number;
};

export function MiniGameScoresForm({
  existingGames,
  heading = "Game scores",
  saveAction = saveMiniGameScores,
  sessionId,
  sessionLabel = "Session",
  teams
}: {
  existingGames: MatchInput[];
  heading?: string;
  saveAction?: typeof saveMiniGameScores;
  sessionId: string;
  sessionLabel?: string;
  teams: TeamOption[];
}) {
  const [state, action, pending] = useActionState(saveAction, null as { success?: boolean; message?: string; error?: string } | null);
  const [games, setGames] = useState<MatchInput[]>(() => existingGames.length ? existingGames : defaultGames(teams));
  const [newTeamAId, setNewTeamAId] = useState(teams[0]?.id ?? "");
  const [newTeamBId, setNewTeamBId] = useState(teams[1]?.id ?? "");
  const [newAwayTeamId, setNewAwayTeamId] = useState("");
  const playersByTeam = useMemo(() => new Map(teams.map((team) => [team.id, team.players])), [teams]);
  const teamByPlayer = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) {
      for (const player of team.players) map.set(player.id, team.id);
    }
    return map;
  }, [teams]);
  const numberedGames = games.map((game, index) => ({ ...game, matchNumber: index + 1 }));
  const payload = numberedGames.map((game) => ({
    matchNumber: game.matchNumber,
    teamAId: game.teamAId,
    teamBId: game.teamBId,
    awayTeamId: game.awayTeamId === game.teamAId || game.awayTeamId === game.teamBId ? game.awayTeamId : undefined,
    goals: game.goals
      .filter((goal) => goal.scorerId)
      .map((goal) => ({
        scorerId: goal.scorerId,
        assistPlayerId: goal.goalType === "own_goal" ? undefined : goal.assistPlayerId || undefined,
        sessionTeamId: inferScoringTeamId(goal, game, teamByPlayer),
        goalCount: goal.goalCount,
        goalType: goal.goalType
      }))
  }));

  useEffect(() => {
    if (state?.success) toast.success(state.message ?? "Scores saved.");
    if (state?.error) toast.error(state.error);
  }, [state]);

  useEffect(() => {
    if (newAwayTeamId && newAwayTeamId !== newTeamAId && newAwayTeamId !== newTeamBId) setNewAwayTeamId("");
  }, [newAwayTeamId, newTeamAId, newTeamBId]);

  function updateGame(key: string, patch: Partial<MatchInput>) {
    setGames((current) => current.map((game) => game.key === key ? { ...game, ...patch } : game));
  }

  function updateGoal(gameKey: string, goalKey: string, patch: Partial<GoalInput>) {
    setGames((current) =>
      current.map((game) =>
        game.key === gameKey
          ? { ...game, goals: game.goals.map((goal) => goal.key === goalKey ? { ...goal, ...patch } : goal) }
          : game
      )
    );
  }

  function addGame() {
    setGames((current) => [
      ...current,
      {
        key: `new-game-${Date.now()}`,
        matchNumber: current.length + 1,
        teamAId: newTeamAId,
        teamBId: newTeamBId,
        awayTeamId: newAwayTeamId === newTeamAId || newAwayTeamId === newTeamBId ? newAwayTeamId : "",
        goals: []
      }
    ]);
  }

  return (
    <form action={action} className="grid gap-4">
      <input name="sessionId" type="hidden" value={sessionId} />
      <input name="gamesJson" type="hidden" value={JSON.stringify(payload)} />
      <div className="panel grid gap-3 p-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <h1 className="page-title">{heading}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sessionLabel}: select teams, add a game, then record goals, assists, and own goals. Scores are calculated from goal events.
          </p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-[180px_180px_180px_auto] sm:items-end lg:w-auto">
          <TeamSelect label="Team A" onChange={setNewTeamAId} teams={teams} value={newTeamAId} />
          <TeamSelect label="Team B" onChange={setNewTeamBId} teams={teams} value={newTeamBId} />
          <TeamSelect
            label="Away team"
            onChange={setNewAwayTeamId}
            optional
            teams={teams.filter((team) => team.id === newTeamAId || team.id === newTeamBId)}
            value={newAwayTeamId === newTeamAId || newAwayTeamId === newTeamBId ? newAwayTeamId : ""}
          />
          <button className="btn-secondary min-h-9 px-3 text-xs sm:text-sm" disabled={!newTeamAId || !newTeamBId || newTeamAId === newTeamBId} onClick={addGame} type="button">
            <Plus className="h-4 w-4" />
            Add game
          </button>
        </div>
      </div>
      <div className="grid gap-3">
        {numberedGames.map((game) => {
          const selectablePlayers = uniquePlayers([
            ...(playersByTeam.get(game.teamAId) ?? []),
            ...(playersByTeam.get(game.teamBId) ?? [])
          ]);
          const gameScore = calculateGameScore(game, teamByPlayer);
          const teamAName = teamName(teams, game.teamAId);
          const teamBName = teamName(teams, game.teamBId);
          const awayTeamId = game.awayTeamId === game.teamAId || game.awayTeamId === game.teamBId ? game.awayTeamId : "";
          const homeTeamName = awayTeamId ? teamName(teams, awayTeamId === game.teamAId ? game.teamBId : game.teamAId) : "";
          const awayTeamName = awayTeamId ? teamName(teams, awayTeamId) : "";
          return (
            <section className="panel overflow-hidden" key={game.key}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-50 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-md bg-pitch text-xs font-black text-white">G{game.matchNumber}</div>
                  <div className="truncate text-sm font-semibold text-ink">{teamAName}</div>
                  <div className="grid h-8 min-w-16 place-items-center rounded-md border border-line bg-white px-2 text-base font-black text-ink">
                    {gameScore.teamAScore}-{gameScore.teamBScore}
                  </div>
                  <div className="truncate text-sm font-semibold text-ink">{teamBName}</div>
                  {awayTeamId ? (
                    <div className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-pitch ring-1 ring-emerald-100">
                      {homeTeamName} home | {awayTeamName} away
                    </div>
                  ) : null}
                </div>
                <button className="btn-secondary min-h-8 px-2 text-xs" onClick={() => setGames((current) => current.filter((item) => item.key !== game.key))} type="button">
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              </div>

              <div className="grid gap-2 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Goals and assists</h3>
                    <p className="text-xs text-slate-500">{teamAName} vs {teamBName}</p>
                  </div>
                  <button
                    className="btn-secondary min-h-8 px-3 text-xs"
                    onClick={() =>
                      updateGame(game.key, {
                        goals: [
                          ...game.goals,
                          { key: randomKey("goal"), scorerId: "", assistPlayerId: "", goalType: "goal", goalCount: 1 }
                        ]
                      })
                    }
                    type="button"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add goal
                  </button>
                </div>
                {game.goals.map((goal) => {
                  const scorerTeamId = teamByPlayer.get(goal.scorerId) ?? "";
                  const assistPlayers = goal.scorerId && scorerTeamId ? playersByTeam.get(scorerTeamId) ?? [] : selectablePlayers;
                  return (
                    <div className="grid gap-2 rounded-md border border-line bg-slate-50 p-2" key={goal.key}>
                      <div className="grid gap-2 lg:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
                        <GoalTypeSelect onChange={(value) => updateGoal(game.key, goal.key, { goalType: value, assistPlayerId: value === "own_goal" ? "" : goal.assistPlayerId })} value={goal.goalType} />
                        <PlayerSelect
                          label={goal.goalType === "own_goal" ? "Own goal by" : "Scorer"}
                          onChange={(value) => updateGoal(game.key, goal.key, { scorerId: value, assistPlayerId: "" })}
                          players={selectablePlayers}
                          value={goal.scorerId}
                        />
                        <PlayerSelect disabled={goal.goalType === "own_goal"} label="Assist" onChange={(value) => updateGoal(game.key, goal.key, { assistPlayerId: value })} players={assistPlayers} value={goal.assistPlayerId} optional />
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="grid w-20 shrink-0 gap-1 text-xs font-semibold uppercase text-slate-500">
                          Count
                          <input className="input min-h-9 w-full px-2 text-center text-sm font-semibold" min="1" onChange={(event) => updateGoal(game.key, goal.key, { goalCount: Number(event.target.value) })} type="number" value={goal.goalCount} />
                        </label>
                        <button className="btn-secondary min-h-9 w-11 shrink-0 px-0" onClick={() => updateGame(game.key, { goals: game.goals.filter((item) => item.key !== goal.key) })} type="button" aria-label="Delete goal">
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <div className="min-h-9 min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-2 text-xs text-slate-600">
                          Credit: <span className="font-semibold text-ink">{teamName(teams, inferScoringTeamId(goal, game, teamByPlayer))}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!game.goals.length ? <p className="text-sm text-slate-500">No goal details added for this game.</p> : null}
              </div>
            </section>
          );
        })}
      </div>
      <button className="btn-primary sticky bottom-3 z-10 w-fit shadow-lg sm:static sm:shadow-sm" disabled={pending || !teams.length}>
        <Save className="h-4 w-4" />
        {pending ? "Saving..." : "Save game scores"}
      </button>
    </form>
  );
}

function TeamSelect({ className = "", compact = false, label, onChange, optional = false, teams, value }: { className?: string; compact?: boolean; label: string; onChange: (value: string) => void; optional?: boolean; teams: TeamOption[]; value: string }) {
  return (
    <label className={`grid gap-1 ${className} ${compact ? "text-xs font-semibold uppercase text-slate-500" : "text-xs font-semibold uppercase text-slate-500"}`}>
      {label}
      <select className="input min-h-9 px-2 text-sm" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{optional ? "No away team" : "Select team"}</option>
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
    </label>
  );
}

function GoalTypeSelect({ onChange, value }: { onChange: (value: GoalInput["goalType"]) => void; value: GoalInput["goalType"] }) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase text-slate-500">
      Type
      <select className="input min-h-9 px-2 text-sm" onChange={(event) => onChange(event.target.value as GoalInput["goalType"])} value={value}>
        <option value="goal">Goal</option>
        <option value="own_goal">Own goal</option>
      </select>
    </label>
  );
}

function PlayerSelect({ className = "", disabled = false, label, onChange, optional = false, players, value }: { className?: string; disabled?: boolean; label: string; onChange: (value: string) => void; optional?: boolean; players: Array<{ id: string; name: string }>; value: string }) {
  return (
    <label className={`grid gap-1 text-xs font-semibold uppercase text-slate-500 ${className}`}>
      {label}
      <select className="input min-h-9 px-2 text-sm disabled:bg-slate-100 disabled:text-slate-400" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={disabled ? "" : value}>
        <option value="">{optional ? "No assist" : "Select player"}</option>
        {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
      </select>
    </label>
  );
}

function defaultGames(_teams: TeamOption[]) {
  return [];
}

function uniquePlayers(players: Array<{ id: string; name: string }>) {
  return Array.from(new Map(players.map((player) => [player.id, player])).values()).sort((left, right) => left.name.localeCompare(right.name));
}

function randomKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function calculateGameScore(game: MatchInput, teamByPlayer: Map<string, string>) {
  return game.goals.reduce(
    (score, goal) => {
      const scoringTeamId = inferScoringTeamId(goal, game, teamByPlayer);
      const count = Math.max(1, Number(goal.goalCount ?? 1) || 1);
      if (scoringTeamId === game.teamAId) score.teamAScore += count;
      if (scoringTeamId === game.teamBId) score.teamBScore += count;
      return score;
    },
    { teamAScore: 0, teamBScore: 0 }
  );
}

function inferScoringTeamId(goal: GoalInput, game: Pick<MatchInput, "teamAId" | "teamBId">, teamByPlayer: Map<string, string>) {
  const playerTeamId = teamByPlayer.get(goal.scorerId);
  if (goal.goalType === "own_goal") {
    if (playerTeamId === game.teamAId) return game.teamBId;
    if (playerTeamId === game.teamBId) return game.teamAId;
    return "";
  }
  return playerTeamId === game.teamAId || playerTeamId === game.teamBId ? playerTeamId : "";
}

function teamName(teams: TeamOption[], teamId: string) {
  return teams.find((team) => team.id === teamId)?.name ?? "-";
}
