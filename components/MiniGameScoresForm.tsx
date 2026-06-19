"use client";

import { Fragment, useActionState, useEffect, useMemo, useState } from "react";
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
  displayOrder?: number;
  teamAId: string;
  teamBId: string;
  awayTeamId?: string;
  resultStatus?: "scheduled" | "played";
  scheduledStartTime?: string;
  scheduledEndTime?: string;
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
  readOnly = false,
  readOnlyReason = "Scores are read-only for this session.",
  saveAction = saveMiniGameScores,
  sessionId,
  sessionLabel = "Session",
  teams
}: {
  existingGames: MatchInput[];
  heading?: string;
  readOnly?: boolean;
  readOnlyReason?: string;
  saveAction?: typeof saveMiniGameScores;
  sessionId: string;
  sessionLabel?: string;
  teams: TeamOption[];
}) {
  const [state, action, pending] = useActionState(saveAction, null as { success?: boolean; message?: string; error?: string } | null);
  const [games, setGames] = useState<MatchInput[]>(() => existingGames.length ? existingGames : defaultGames(teams));
  const playersByTeam = useMemo(() => new Map(teams.map((team) => [team.id, team.players])), [teams]);
  const teamByPlayer = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) {
      for (const player of team.players) map.set(player.id, team.id);
    }
    return map;
  }, [teams]);
  const payload = games.map((game, index) => ({
    matchNumber: game.matchNumber,
    displayOrder: game.matchNumber || index + 1,
    teamAId: game.teamAId,
    teamBId: game.teamBId,
    awayTeamId: game.awayTeamId === game.teamAId || game.awayTeamId === game.teamBId ? game.awayTeamId : undefined,
    resultStatus: hasScoredGoals(game) ? "played" : game.resultStatus,
    scheduledStartTime: game.scheduledStartTime || undefined,
    scheduledEndTime: game.scheduledEndTime || undefined,
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

  return (
    <form action={action} className="grid gap-4 pb-20">
      <input name="sessionId" type="hidden" value={sessionId} />
      <input name="gamesJson" type="hidden" value={JSON.stringify(payload)} />
      <div className="panel grid gap-3 p-3">
        <div>
          <h1 className="page-title">{heading}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sessionLabel}: record goals, assists, and own goals against the saved fixture. Scores are calculated from goal events.
          </p>
          {readOnly ? <p className="mt-2 text-sm font-medium text-amber-700">{readOnlyReason}</p> : null}
        </div>
      </div>
      <div className="grid gap-3">
        {games.map((game, index) => {
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
          const previousGame = index > 0 ? games[index - 1] : null;
          const breakMinutes = minutesBetween(previousGame?.scheduledEndTime, game.scheduledStartTime);
          const scoredGoals = hasScoredGoals(game);
          const isPlayed = scoredGoals || game.resultStatus === "played";
          return (
            <Fragment key={game.key}>
            {breakMinutes > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                Break: {breakMinutes} min
              </div>
            ) : null}
            <section
              className="panel overflow-hidden"
              key={game.key}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-50 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-md bg-pitch text-xs font-black text-white">G{game.matchNumber}</div>
                  {game.scheduledStartTime && game.scheduledEndTime ? (
                    <div className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                      {formatTime(game.scheduledStartTime)}-{formatTime(game.scheduledEndTime)}
                    </div>
                  ) : null}
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
                <button
                  aria-checked={isPlayed}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${
                    isPlayed
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-line bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50"
                  } disabled:cursor-not-allowed disabled:opacity-75`}
                  disabled={readOnly || scoredGoals}
                  onClick={() => updateGame(game.key, { resultStatus: isPlayed ? "scheduled" : "played" })}
                  role="switch"
                  type="button"
                >
                  <span className={`grid h-5 w-9 items-center rounded-full px-0.5 transition ${isPlayed ? "bg-emerald-600" : "bg-slate-300"}`}>
                    <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${isPlayed ? "translate-x-4" : "translate-x-0"}`} />
                  </span>
                  Played{scoredGoals ? " (auto)" : ""}
                </button>
              </div>

              <div className="grid gap-2 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Goals and assists</h3>
                    <p className="text-xs text-slate-500">{teamAName} vs {teamBName}</p>
                  </div>
                  {!readOnly ? (
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
                  ) : null}
                </div>
                {game.goals.map((goal) => {
                  const scorerTeamId = teamByPlayer.get(goal.scorerId) ?? "";
                  const assistPlayers = goal.scorerId && scorerTeamId ? playersByTeam.get(scorerTeamId) ?? [] : selectablePlayers;
                  return (
                    <div className="grid gap-2 rounded-md border border-line bg-slate-50 p-2" key={goal.key}>
                      <div className="grid gap-2 lg:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
                        <GoalTypeSelect disabled={readOnly} onChange={(value) => updateGoal(game.key, goal.key, { goalType: value, assistPlayerId: value === "own_goal" ? "" : goal.assistPlayerId })} value={goal.goalType} />
                        <PlayerSelect
                          disabled={readOnly}
                          label={goal.goalType === "own_goal" ? "Own goal by" : "Scorer"}
                          onChange={(value) => updateGoal(game.key, goal.key, { scorerId: value, assistPlayerId: "" })}
                          players={selectablePlayers}
                          value={goal.scorerId}
                        />
                        <PlayerSelect disabled={readOnly || goal.goalType === "own_goal"} label="Assist" onChange={(value) => updateGoal(game.key, goal.key, { assistPlayerId: value })} players={assistPlayers} value={goal.assistPlayerId} optional />
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="grid w-20 shrink-0 gap-1 text-xs font-semibold uppercase text-slate-500">
                          Count
                          <input className="input min-h-9 w-full px-2 text-center text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-400" disabled={readOnly} min="1" onChange={(event) => updateGoal(game.key, goal.key, { goalCount: Number(event.target.value) })} type="number" value={goal.goalCount} />
                        </label>
                        {!readOnly ? (
                          <button className="btn-secondary min-h-9 w-11 shrink-0 px-0" onClick={() => updateGame(game.key, { goals: game.goals.filter((item) => item.key !== goal.key) })} type="button" aria-label="Delete goal">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
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
            </Fragment>
          );
        })}
      </div>
      {!readOnly ? (
        <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-end sm:left-auto">
          <button className="btn-primary w-full shadow-lg sm:w-auto" disabled={pending || !teams.length}>
            <Save className="h-4 w-4" />
            {pending ? "Saving..." : "Save game scores"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

function GoalTypeSelect({ disabled = false, onChange, value }: { disabled?: boolean; onChange: (value: GoalInput["goalType"]) => void; value: GoalInput["goalType"] }) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase text-slate-500">
      Type
      <select className="input min-h-9 px-2 text-sm disabled:bg-slate-100 disabled:text-slate-400" disabled={disabled} onChange={(event) => onChange(event.target.value as GoalInput["goalType"])} value={value}>
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
      <select className="input min-h-9 px-2 text-sm disabled:bg-slate-100 disabled:text-slate-400" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
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

function hasScoredGoals(game: MatchInput) {
  return game.goals.some((goal) => Boolean(goal.scorerId));
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

function parseTimeToMinutes(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function minutesBetween(start?: string | null, end?: string | null) {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes == null || endMinutes == null) return 0;
  return Math.max(0, endMinutes - startMinutes);
}
