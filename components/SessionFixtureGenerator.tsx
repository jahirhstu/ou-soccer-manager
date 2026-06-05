"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Save, Wand2 } from "lucide-react";
import { saveSessionFixture } from "@/lib/actions/session-management";

export type FixtureTeam = {
  id: string;
  name: string;
};

export type FixtureGame = {
  key: string;
  matchNumber: number;
  displayOrder?: number;
  teamAId: string;
  teamBId: string;
  awayTeamId?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
};

export function SessionFixtureGenerator({
  existingGames,
  hasPlayedMatches = false,
  readOnly = false,
  sessionEndTime,
  sessionId,
  sessionLabel = "Session",
  sessionStartTime,
  teams
}: {
  existingGames: FixtureGame[];
  hasPlayedMatches?: boolean;
  readOnly?: boolean;
  sessionEndTime?: string | null;
  sessionId: string;
  sessionLabel?: string;
  sessionStartTime?: string | null;
  teams: FixtureTeam[];
}) {
  const [state, action, pending] = useActionState(saveSessionFixture, null as { success?: boolean; message?: string; error?: string } | null);
  const [games, setGames] = useState<FixtureGame[]>(() => renumberGames(existingGames));
  const [avoidFirstTeamId, setAvoidFirstTeamId] = useState("");
  const [repeatMatchups, setRepeatMatchups] = useState(teams.length === 2 ? 3 : 2);
  const [breakAfterGames, setBreakAfterGames] = useState(3);
  const [breakLengthMinutes, setBreakLengthMinutes] = useState(10);
  const [firstSegmentMinutes, setFirstSegmentMinutes] = useState(15);
  const [secondSegmentMinutes, setSecondSegmentMinutes] = useState(18);
  const [transitionMinutes, setTransitionMinutes] = useState(2);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const backToBackSummary = useMemo(() => summarizeBackToBack(games, teamsById), [games, teamsById]);
  const locked = readOnly || hasPlayedMatches;
  const payload = renumberGames(games).map((game, index) => ({
    matchNumber: index + 1,
    displayOrder: index + 1,
    teamAId: game.teamAId,
    teamBId: game.teamBId,
    awayTeamId: game.awayTeamId === game.teamAId || game.awayTeamId === game.teamBId ? game.awayTeamId : undefined,
    scheduledStartTime: game.scheduledStartTime || undefined,
    scheduledEndTime: game.scheduledEndTime || undefined
  }));

  useEffect(() => {
    if (state?.success) toast.success(state.message ?? "Fixture saved.");
    if (state?.error) toast.error(state.error);
  }, [state]);

  function generateFixture() {
    if (teams.length < 2 || locked) return;
    const pairings = optimizePairingOrder(generatePairings(teams, Math.max(1, Number(repeatMatchups) || 1), avoidFirstTeamId), avoidFirstTeamId);
    const timedGames = applyFixtureTimes(
      pairings.map((pairing, index) => ({
        key: randomKey("fixture-game"),
        matchNumber: index + 1,
        teamAId: pairing.teamAId,
        teamBId: pairing.teamBId,
        awayTeamId: pairing.teamBId
      })),
      {
        breakAfterGames: Math.max(0, Number(breakAfterGames) || 0),
        breakLengthMinutes: Math.max(0, Number(breakLengthMinutes) || 0),
        firstSegmentMinutes: Math.max(1, Number(firstSegmentMinutes) || 1),
        secondSegmentMinutes: Math.max(1, Number(secondSegmentMinutes) || 1),
        transitionMinutes: Math.max(0, Number(transitionMinutes) || 0),
        sessionStartTime
      }
    );
    setGames(timedGames);
  }

  function moveGame(index: number, direction: -1 | 1) {
    setGames((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return retimeGames(renumberGames(next));
    });
  }

  function retimeGames(rows: FixtureGame[]) {
    if (!rows.some((game) => game.scheduledStartTime || game.scheduledEndTime)) return rows;
    return applyFixtureTimes(rows, {
      breakAfterGames: Math.max(0, Number(breakAfterGames) || 0),
      breakLengthMinutes: Math.max(0, Number(breakLengthMinutes) || 0),
      firstSegmentMinutes: Math.max(1, Number(firstSegmentMinutes) || 1),
      secondSegmentMinutes: Math.max(1, Number(secondSegmentMinutes) || 1),
      transitionMinutes: Math.max(0, Number(transitionMinutes) || 0),
      sessionStartTime
    });
  }

  function updateAwayTeam(gameKey: string, awayTeamId: string) {
    setGames((current) =>
      current.map((game) => game.key === gameKey
        ? { ...game, awayTeamId: awayTeamId === game.teamAId || awayTeamId === game.teamBId ? awayTeamId : "" }
        : game
      )
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <input name="sessionId" type="hidden" value={sessionId} />
      <input name="gamesJson" type="hidden" value={JSON.stringify(payload)} />

      <section className="panel grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="page-title">Generate fixture</h1>
            <p className="mt-1 text-sm text-slate-500">{sessionLabel}: generate, order, and save the session fixture.</p>
          </div>
          <button className="btn-secondary min-h-9 px-3 text-xs sm:text-sm" disabled={locked || teams.length < 2} onClick={generateFixture} type="button">
            <Wand2 className="h-4 w-4" />
            {games.length ? "Regenerate draft" : "Generate draft"}
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TeamSelect label="Avoid first game" onChange={setAvoidFirstTeamId} optionalLabel="No preference" teams={teams} value={avoidFirstTeamId} />
          <NumberInput label="Repeats" min={1} onChange={setRepeatMatchups} value={repeatMatchups} />
          <NumberInput label="Break after" min={0} onChange={setBreakAfterGames} value={breakAfterGames} />
          <NumberInput label="Break min" min={0} onChange={setBreakLengthMinutes} value={breakLengthMinutes} />
          <NumberInput label="Transition min" min={0} onChange={setTransitionMinutes} value={transitionMinutes} />
          <NumberInput label="First games min" min={1} onChange={setFirstSegmentMinutes} value={firstSegmentMinutes} />
          <NumberInput label="Later games min" min={1} onChange={setSecondSegmentMinutes} value={secondSegmentMinutes} />
        </div>

        <p className="text-xs text-slate-500">
          Session time: {formatSessionTimeRange(sessionStartTime, sessionEndTime)}. Repeated matchups reverse home/away by default.
        </p>
        {teams.length < 2 ? <p className="text-xs font-medium text-amber-700">Create at least two teams before generating fixtures.</p> : null}
        {hasPlayedMatches ? <p className="text-xs font-medium text-amber-700">Fixture cannot be changed after game scores have been saved.</p> : null}
      </section>

      {backToBackSummary.total ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Back-to-back warning</div>
          <div className="mt-1">
            {backToBackSummary.maxTeams.map((team) => `${team.name} (${team.count})`).join(", ")} {backToBackSummary.maxTeams.length === 1 ? "has" : "have"} the most back-to-back games.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {backToBackSummary.rows.map((row) => (
              <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold ring-1 ring-amber-200" key={row.teamId}>
                {row.name}: {row.count}
              </span>
            ))}
          </div>
        </section>
      ) : games.length ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-pitch">
          No back-to-back games in this draft.
        </section>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="section-title">Fixture games</h2>
            <p className="text-sm text-slate-500">Use arrows to reorder games and choose the away team for each matchup.</p>
          </div>
          {!locked ? (
            <button className="btn-primary" disabled={pending || !games.length || teams.length < 2}>
              <Save className="h-4 w-4" />
              {pending ? "Saving..." : "Save fixture"}
            </button>
          ) : null}
        </div>

        {games.map((game, index) => {
          const teamAName = teamsById.get(game.teamAId) ?? "Team A";
          const teamBName = teamsById.get(game.teamBId) ?? "Team B";
          const previousGame = index > 0 ? games[index - 1] : null;
          const breakMinutes = minutesBetween(previousGame?.scheduledEndTime, game.scheduledStartTime);
          const repeatedTeams = previousGame ? [game.teamAId, game.teamBId].filter((teamId) => teamId === previousGame.teamAId || teamId === previousGame.teamBId) : [];
          return (
            <div className="grid gap-2" key={game.key}>
              {breakMinutes > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                  Break: {breakMinutes} min
                </div>
              ) : null}
              <article className="panel overflow-hidden">
                <div className="grid gap-3 border-b border-line bg-slate-50 px-3 py-3 lg:grid-cols-[auto_minmax(0,1fr)_220px] lg:items-center">
                  <div className="flex items-center gap-2">
                    <button aria-label="Move game up" className="btn-secondary min-h-8 w-9 px-0" disabled={locked || index === 0} onClick={() => moveGame(index, -1)} type="button">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button aria-label="Move game down" className="btn-secondary min-h-8 w-9 px-0" disabled={locked || index === games.length - 1} onClick={() => moveGame(index, 1)} type="button">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <div className="grid h-8 w-8 place-items-center rounded-md bg-pitch text-xs font-black text-white">G{index + 1}</div>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {game.scheduledStartTime && game.scheduledEndTime ? (
                      <div className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                        {formatTime(game.scheduledStartTime)}-{formatTime(game.scheduledEndTime)}
                      </div>
                    ) : null}
                    <div className="truncate text-sm font-semibold text-ink">{teamAName}</div>
                    <div className="text-xs font-semibold uppercase text-slate-400">vs</div>
                    <div className="truncate text-sm font-semibold text-ink">{teamBName}</div>
                    {repeatedTeams.length ? (
                      <div className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                        Back-to-back: {repeatedTeams.map((teamId) => teamsById.get(teamId) ?? "Team").join(", ")}
                      </div>
                    ) : null}
                  </div>
                  <label className="grid gap-1 text-xs font-semibold uppercase text-slate-500">
                    Away team
                    <select className="input min-h-9 px-2 text-sm" disabled={locked} onChange={(event) => updateAwayTeam(game.key, event.target.value)} value={game.awayTeamId ?? ""}>
                      <option value="">No home/away</option>
                      <option value={game.teamAId}>{teamAName} away</option>
                      <option value={game.teamBId}>{teamBName} away</option>
                    </select>
                  </label>
                </div>
              </article>
            </div>
          );
        })}

        {!games.length ? <div className="panel border-dashed p-10 text-center text-sm text-slate-500">No fixture generated yet.</div> : null}
      </section>
    </form>
  );
}

function TeamSelect({ label, onChange, optionalLabel, teams, value }: { label: string; onChange: (value: string) => void; optionalLabel: string; teams: FixtureTeam[]; value: string }) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-slate-500">
      {label}
      <select className="input min-h-9 w-full px-2 text-sm" onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{optionalLabel}</option>
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
    </label>
  );
}

function NumberInput({ label, min, onChange, value }: { label: string; min: number; onChange: (value: number) => void; value: number }) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-slate-500">
      {label}
      <input className="input min-h-9 w-full px-2 text-sm" min={min} onChange={(event) => onChange(Number(event.target.value))} type="number" value={value} />
    </label>
  );
}

function renumberGames(rows: FixtureGame[]) {
  return rows.map((game, index) => ({ ...game, matchNumber: index + 1, displayOrder: index + 1 }));
}

function randomKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function generatePairings(teams: FixtureTeam[], repeats: number, avoidFirstTeamId: string) {
  const basePairs: Array<{ teamAId: string; teamBId: string }> = [];
  for (let left = 0; left < teams.length; left += 1) {
    for (let right = left + 1; right < teams.length; right += 1) {
      basePairs.push({ teamAId: teams[left].id, teamBId: teams[right].id });
    }
  }

  if (avoidFirstTeamId) {
    const preferredIndex = basePairs.findIndex((pair) => pair.teamAId !== avoidFirstTeamId && pair.teamBId !== avoidFirstTeamId);
    if (preferredIndex > 0) {
      const [preferred] = basePairs.splice(preferredIndex, 1);
      basePairs.unshift(preferred);
    }
  }

  const pairings: Array<{ teamAId: string; teamBId: string }> = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const pair of basePairs) {
      pairings.push(repeat % 2 === 0 ? pair : { teamAId: pair.teamBId, teamBId: pair.teamAId });
    }
  }
  return pairings;
}

function optimizePairingOrder(pairings: Array<{ teamAId: string; teamBId: string }>, avoidFirstTeamId: string) {
  const remaining = [...pairings];
  const ordered: Array<{ teamAId: string; teamBId: string }> = [];
  const backToBackCounts = new Map<string, number>();

  while (remaining.length) {
    const previous = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const overlap = previous ? sharedTeamCount(previous, candidate) : 0;
      const candidateLoad = (backToBackCounts.get(candidate.teamAId) ?? 0) + (backToBackCounts.get(candidate.teamBId) ?? 0);
      const avoidFirstPenalty = !previous && avoidFirstTeamId && hasTeam(candidate, avoidFirstTeamId) ? 100 : 0;
      const score = overlap * 1000 + candidateLoad * 10 + avoidFirstPenalty + index;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    const previousGame = ordered[ordered.length - 1];
    if (previousGame) {
      for (const teamId of sharedTeamIds(previousGame, next)) {
        backToBackCounts.set(teamId, (backToBackCounts.get(teamId) ?? 0) + 1);
      }
    }
    ordered.push(next);
  }

  return ordered;
}

function summarizeBackToBack(games: FixtureGame[], teamsById: Map<string, string>) {
  const counts = new Map<string, number>();
  for (let index = 1; index < games.length; index += 1) {
    for (const teamId of sharedTeamIds(games[index - 1], games[index])) {
      counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
    }
  }

  const rows = Array.from(counts.entries())
    .map(([teamId, count]) => ({ teamId, name: teamsById.get(teamId) ?? "Team", count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  const max = rows[0]?.count ?? 0;

  return {
    maxTeams: rows.filter((row) => row.count === max),
    rows,
    total: rows.reduce((total, row) => total + row.count, 0)
  };
}

function hasTeam(pairing: { teamAId: string; teamBId: string }, teamId: string) {
  return pairing.teamAId === teamId || pairing.teamBId === teamId;
}

function sharedTeamCount(left: { teamAId: string; teamBId: string }, right: { teamAId: string; teamBId: string }) {
  return sharedTeamIds(left, right).length;
}

function sharedTeamIds(left: { teamAId: string; teamBId: string }, right: { teamAId: string; teamBId: string }) {
  return [right.teamAId, right.teamBId].filter((teamId) => teamId === left.teamAId || teamId === left.teamBId);
}

function applyFixtureTimes(
  rows: FixtureGame[],
  options: {
    breakAfterGames: number;
    breakLengthMinutes: number;
    firstSegmentMinutes: number;
    secondSegmentMinutes: number;
    transitionMinutes: number;
    sessionStartTime?: string | null;
  }
) {
  const startMinutes = parseTimeToMinutes(options.sessionStartTime);
  if (startMinutes == null) {
    return rows.map((row) => ({ ...row, scheduledStartTime: "", scheduledEndTime: "" }));
  }

  let cursor = startMinutes;
  return rows.map((row, index) => {
    if (options.breakAfterGames > 0 && index === options.breakAfterGames) cursor += options.breakLengthMinutes;
    if (index > 0) cursor += options.transitionMinutes;
    const duration = options.breakAfterGames > 0 && index >= options.breakAfterGames
      ? options.secondSegmentMinutes
      : options.firstSegmentMinutes;
    const scheduledStartTime = minutesToTime(cursor);
    cursor += duration;
    return {
      ...row,
      scheduledStartTime,
      scheduledEndTime: minutesToTime(cursor)
    };
  });
}

function parseTimeToMinutes(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const minutesInDay = 24 * 60;
  const normalized = ((value % minutesInDay) + minutesInDay) % minutesInDay;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatSessionTimeRange(start?: string | null, end?: string | null) {
  if (!start && !end) return "not configured";
  if (!end) return `${formatTime(start)} start`;
  if (!start) return `${formatTime(end)} end`;
  return `${formatTime(start)}-${formatTime(end)}`;
}

function minutesBetween(start?: string | null, end?: string | null) {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes == null || endMinutes == null) return 0;
  return Math.max(0, endMinutes - startMinutes);
}
