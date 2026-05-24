"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { saveMiniGameScores } from "@/lib/actions/session-management";

type TeamOption = {
  id: string;
  name: string;
  players: Array<{ id: string; name: string }>;
};

type MatchInput = {
  key: string;
  matchNumber: number;
  teamAId: string;
  teamBId: string;
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
  sessionId,
  teams
}: {
  existingGames: MatchInput[];
  sessionId: string;
  teams: TeamOption[];
}) {
  const [state, action, pending] = useActionState(saveMiniGameScores, null as { success?: boolean; message?: string; error?: string } | null);
  const [games, setGames] = useState<MatchInput[]>(() => existingGames.length ? existingGames : defaultGames(teams));
  const playersByTeam = useMemo(() => new Map(teams.map((team) => [team.id, team.players])), [teams]);
  const teamByPlayer = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) {
      for (const player of team.players) map.set(player.id, team.id);
    }
    return map;
  }, [teams]);
  const payload = games.map((game) => ({
    matchNumber: game.matchNumber,
    teamAId: game.teamAId,
    teamBId: game.teamBId,
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
        matchNumber: current.length ? Math.max(...current.map((game) => game.matchNumber)) + 1 : 1,
        teamAId: teams[0]?.id ?? "",
        teamBId: teams[1]?.id ?? "",
        goals: []
      }
    ]);
  }

  return (
    <form action={action} className="grid gap-4">
      <input name="sessionId" type="hidden" value={sessionId} />
      <input name="gamesJson" type="hidden" value={JSON.stringify(payload)} />
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
        <p className="max-w-2xl text-sm text-slate-500">Pick teams for each mini-game. Scores are calculated automatically from goals, assists, and own goals.</p>
        <button className="btn-secondary min-h-9 px-3 text-xs sm:text-sm" onClick={addGame} type="button">
          <Plus className="h-4 w-4" />
          Add game
        </button>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {games.map((game) => {
          const selectablePlayers = uniquePlayers([
            ...(playersByTeam.get(game.teamAId) ?? []),
            ...(playersByTeam.get(game.teamBId) ?? [])
          ]);
          const gameScore = calculateGameScore(game, teamByPlayer);
          const teamAName = teamName(teams, game.teamAId);
          const teamBName = teamName(teams, game.teamBId);
          return (
            <section className="panel overflow-hidden" key={game.key}>
              <div className="flex items-center justify-between gap-3 border-b border-line bg-slate-50 px-3 py-2.5 sm:px-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-md bg-pitch text-xs font-black text-white">{game.matchNumber}</span>
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Mini-game {game.matchNumber}</h2>
                    <p className="text-xs text-slate-500">{teamAName} {gameScore.teamAScore}-{gameScore.teamBScore} {teamBName}</p>
                  </div>
                </div>
                <button className="btn-secondary min-h-8 px-2" onClick={() => setGames((current) => current.filter((item) => item.key !== game.key))} type="button">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 p-3 sm:p-4">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="grid w-16 gap-1 text-xs font-semibold uppercase text-slate-500">
                    Game
                    <input className="input min-h-9 px-2 text-center text-sm font-semibold" max="99" min="1" onChange={(event) => updateGame(game.key, { matchNumber: Number(event.target.value) })} type="number" value={game.matchNumber} />
                  </label>
                  <TeamSelect className="w-44 max-w-full sm:w-52" label="Team A" onChange={(value) => updateGame(game.key, { teamAId: value })} teams={teams} value={game.teamAId} />
                  <div className="grid min-h-9 w-12 place-items-center rounded-md border border-line bg-emerald-50 text-sm font-black text-emerald-700">{gameScore.teamAScore}</div>
                </div>
                <div className="flex flex-wrap items-end gap-2 sm:pl-[72px]">
                  <TeamSelect className="w-44 max-w-full sm:w-52" label="Team B" onChange={(value) => updateGame(game.key, { teamBId: value })} teams={teams} value={game.teamBId} />
                  <div className="grid min-h-9 w-12 place-items-center rounded-md border border-line bg-amber-50 text-sm font-black text-amber-700">{gameScore.teamBScore}</div>
                </div>
              </div>

              <div className="grid gap-2 border-t border-line bg-white p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">Goals and assists</h3>
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
                      <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1.2fr)_minmax(10rem,1.2fr)]">
                        <GoalTypeSelect onChange={(value) => updateGoal(game.key, goal.key, { goalType: value, assistPlayerId: value === "own_goal" ? "" : goal.assistPlayerId })} value={goal.goalType} />
                        <PlayerSelect
                          label={goal.goalType === "own_goal" ? "Own goal by" : "Scorer"}
                          onChange={(value) => updateGoal(game.key, goal.key, { scorerId: value, assistPlayerId: "" })}
                          players={selectablePlayers}
                          value={goal.scorerId}
                        />
                        <PlayerSelect disabled={goal.goalType === "own_goal"} label="Assist" onChange={(value) => updateGoal(game.key, goal.key, { assistPlayerId: value })} players={assistPlayers} value={goal.assistPlayerId} optional />
                      </div>
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div className="rounded-md border border-line bg-white px-3 py-2 text-xs text-slate-600">
                          Score credit: <span className="font-semibold text-ink">{teamName(teams, inferScoringTeamId(goal, game, teamByPlayer))}</span>
                        </div>
                        <label className="grid w-24 gap-1 text-xs font-semibold uppercase text-slate-500">
                          Goals
                          <input className="input min-h-9 px-2 text-center text-sm font-semibold" min="1" onChange={(event) => updateGoal(game.key, goal.key, { goalCount: Number(event.target.value) })} type="number" value={goal.goalCount} />
                        </label>
                        <button className="btn-secondary min-h-9 w-11 px-0" onClick={() => updateGame(game.key, { goals: game.goals.filter((item) => item.key !== goal.key) })} type="button" aria-label="Delete goal">
                          <Trash2 className="h-4 w-4" />
                        </button>
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
        {pending ? "Saving..." : "Save mini-games"}
      </button>
    </form>
  );
}

function TeamSelect({ className = "", compact = false, label, onChange, teams, value }: { className?: string; compact?: boolean; label: string; onChange: (value: string) => void; teams: TeamOption[]; value: string }) {
  return (
    <label className={`grid gap-1 ${className} ${compact ? "text-xs font-semibold uppercase text-slate-500" : "text-xs font-semibold uppercase text-slate-500"}`}>
      {label}
      <select className="input min-h-9 px-2 text-sm" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Select team</option>
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

function defaultGames(teams: TeamOption[]) {
  return Array.from({ length: 6 }, (_, index) => ({
    key: `game-${index + 1}`,
    matchNumber: index + 1,
    teamAId: teams[index % Math.max(teams.length, 1)]?.id ?? "",
    teamBId: teams[(index + 1) % Math.max(teams.length, 1)]?.id ?? "",
    goals: []
  }));
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
