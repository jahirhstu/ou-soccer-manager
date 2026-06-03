import { Clock, Coffee, Home, Plane } from "lucide-react";

export type FixtureScheduleItem = {
  matchNumber: number | string | null;
  teamAName: string | null;
  teamBName: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
};

export function FixtureScheduleCard({
  matches,
  sessionLabel
}: {
  matches: FixtureScheduleItem[];
  sessionLabel?: string | null;
}) {
  const sortedMatches = [...matches].sort((left, right) => numberValue(left.matchNumber) - numberValue(right.matchNumber));

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line bg-slate-50 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="section-title">Fixture schedule</h2>
            <p className="mt-1 text-sm text-slate-500">{sessionLabel ? `${sessionLabel} timing, breaks, and home/away order` : "Timing, breaks, and home/away order"}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-md border border-emerald-100 bg-white px-3 py-2 text-xs font-semibold uppercase text-pitch">
            <Clock className="h-4 w-4" />
            {scheduledCount(sortedMatches)} scheduled
          </div>
        </div>
      </div>

      {!sortedMatches.length ? (
        <div className="p-8 text-center text-sm text-slate-500">No fixture has been generated yet.</div>
      ) : (
        <div className="grid gap-0 divide-y divide-line">
          {sortedMatches.map((match, index) => {
            const previous = index > 0 ? sortedMatches[index - 1] : null;
            const breakMinutes = minutesBetween(previous?.scheduledEndTime, match.scheduledStartTime);
            return (
              <div key={`${match.matchNumber}-${match.teamAName}-${match.teamBName}`}>
                {breakMinutes > 0 ? (
                  <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 sm:px-5">
                    <Coffee className="h-4 w-4" />
                    Break: {breakMinutes} min
                  </div>
                ) : null}
                <div className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[92px_150px_minmax(0,1fr)_minmax(210px,0.75fr)] lg:items-center">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-md bg-pitch text-xs font-black text-white">
                      G{match.matchNumber ?? "-"}
                    </span>
                    <span className="text-xs font-semibold uppercase text-slate-500">Game</span>
                  </div>

                  <div className="inline-flex w-fit items-center gap-2 rounded-md border border-line bg-slate-50 px-3 py-2 text-sm font-semibold text-ink">
                    <Clock className="h-4 w-4 text-pitch" />
                    {timeRange(match.scheduledStartTime, match.scheduledEndTime)}
                  </div>

                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold text-ink">
                      <span className="truncate">{match.teamAName ?? "Team A"}</span>
                      <span className="rounded-md border border-line bg-white px-2 py-1 text-xs font-black uppercase text-slate-500">vs</span>
                      <span className="truncate">{match.teamBName ?? "Team B"}</span>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <TeamVenueBadge icon="home" label="Home" value={match.homeTeamName ?? homeFallback(match)} />
                    <TeamVenueBadge icon="away" label="Away" value={match.awayTeamName ?? awayFallback(match)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TeamVenueBadge({ icon, label, value }: { icon: "home" | "away"; label: string; value: string }) {
  const Icon = icon === "home" ? Home : Plane;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-white px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-pitch" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
        <div className="truncate text-sm font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}

function scheduledCount(matches: FixtureScheduleItem[]) {
  const count = matches.filter((match) => match.scheduledStartTime && match.scheduledEndTime).length;
  return `${count}/${matches.length}`;
}

function homeFallback(match: FixtureScheduleItem) {
  return match.homeTeamName || "Not assigned";
}

function awayFallback(match: FixtureScheduleItem) {
  return match.awayTeamName || "Not assigned";
}

function timeRange(start?: string | null, end?: string | null) {
  if (start && end) return `${formatTime(start)}-${formatTime(end)}`;
  if (start) return `${formatTime(start)} start`;
  if (end) return `${formatTime(end)} end`;
  return "TBD";
}

function formatTime(value: string) {
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

function parseTimeToMinutes(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
