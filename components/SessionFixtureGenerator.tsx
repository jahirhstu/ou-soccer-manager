"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { generateSessionFixture } from "@/lib/actions/session-management";

type FixtureTeam = {
  id: string;
  name: string;
};

export function SessionFixtureGenerator({
  disabled = false,
  existingFixtureCount = 0,
  hasPlayedMatches = false,
  sessionEndTime,
  sessionId,
  sessionStartTime,
  teams
}: {
  disabled?: boolean;
  existingFixtureCount?: number;
  hasPlayedMatches?: boolean;
  sessionEndTime?: string | null;
  sessionId: string;
  sessionStartTime?: string | null;
  teams: FixtureTeam[];
}) {
  const [state, action, pending] = useActionState(generateSessionFixture, null as { success?: boolean; message?: string; error?: string } | null);
  const [avoidFirstTeamId, setAvoidFirstTeamId] = useState("");
  const [repeatMatchups, setRepeatMatchups] = useState(teams.length === 2 ? 3 : 2);
  const [breakAfterGames, setBreakAfterGames] = useState(3);
  const [breakLengthMinutes, setBreakLengthMinutes] = useState(10);
  const [firstSegmentMinutes, setFirstSegmentMinutes] = useState(15);
  const [secondSegmentMinutes, setSecondSegmentMinutes] = useState(18);
  const cannotGenerate = disabled || pending || teams.length < 2 || hasPlayedMatches;

  useEffect(() => {
    if (state?.success) toast.success(state.message ?? "Fixture generated.");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="panel grid gap-3 p-3">
      <input name="sessionId" type="hidden" value={sessionId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Fixture generator</h2>
          <p className="text-xs text-slate-500">
            Uses the configured session teams. Generated fixtures appear in the schedule and start standings at zero.
          </p>
        </div>
        <button className="btn-secondary min-h-9 px-3 text-xs sm:text-sm" disabled={cannotGenerate} type="submit">
          <Wand2 className="h-4 w-4" />
          {pending ? "Generating..." : existingFixtureCount ? "Regenerate fixture" : "Generate fixture"}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TeamSelect label="Avoid first game" name="avoidFirstTeamId" onChange={setAvoidFirstTeamId} optionalLabel="No preference" teams={teams} value={avoidFirstTeamId} />
        <NumberInput label="Repeats" min={1} name="repeatMatchups" onChange={setRepeatMatchups} value={repeatMatchups} />
        <NumberInput label="Break after" min={0} name="breakAfterGames" onChange={setBreakAfterGames} value={breakAfterGames} />
        <NumberInput label="Break min" min={0} name="breakLengthMinutes" onChange={setBreakLengthMinutes} value={breakLengthMinutes} />
        <NumberInput label="First games min" min={1} name="firstSegmentMinutes" onChange={setFirstSegmentMinutes} value={firstSegmentMinutes} />
        <NumberInput label="Later games min" min={1} name="secondSegmentMinutes" onChange={setSecondSegmentMinutes} value={secondSegmentMinutes} />
      </div>
      <p className="text-xs text-slate-500">
        Session time: {formatSessionTimeRange(sessionStartTime, sessionEndTime)}. Repeated matchups reverse home/away.
      </p>
      {teams.length < 2 ? <p className="text-xs font-medium text-amber-700">Create at least two teams before generating fixtures.</p> : null}
      {hasPlayedMatches ? <p className="text-xs font-medium text-amber-700">Fixture cannot be regenerated after game scores have been saved.</p> : null}
    </form>
  );
}

function TeamSelect({ label, name, onChange, optionalLabel, teams, value }: { label: string; name: string; onChange: (value: string) => void; optionalLabel: string; teams: FixtureTeam[]; value: string }) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-slate-500">
      {label}
      <select className="input min-h-9 w-full px-2 text-sm" name={name} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{optionalLabel}</option>
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
    </label>
  );
}

function NumberInput({ label, min, name, onChange, value }: { label: string; min: number; name: string; onChange: (value: number) => void; value: number }) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase text-slate-500">
      {label}
      <input className="input min-h-9 w-full px-2 text-sm" min={min} name={name} onChange={(event) => onChange(Number(event.target.value))} type="number" value={value} />
    </label>
  );
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
