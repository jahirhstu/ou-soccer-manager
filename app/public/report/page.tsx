import { Search, ShieldCheck, Trophy } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { cn, money } from "@/lib/utils";

type PublicPlayerReportRow = {
  player_id: string;
  player_name: string | null;
  season_id: string;
  season_name: string | null;
  total_paid_amount: number | string | null;
  total_played_sessions: number | string | null;
  estimated_used_amount: number | string | null;
  credit_amount: number | string | null;
  owes_money: number | string | null;
  balance_amount: number | string | null;
  goals: number | null;
  assists: number | null;
  appearances: number | null;
  last_attended_sessions: string[] | null;
};

export default async function PublicPlayerReportPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; season?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("public_player_report"),
    getCurrentProfile()
  ]);
  const showReturnLink = hasPermission(profile?.role, "manage_attendance");
  const rows = ((data ?? []) as PublicPlayerReportRow[]).filter((row) => {
    if (filters.q && !String(row.player_name ?? "").toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.season && row.season_id !== filters.season) return false;
    return true;
  });
  const seasons = uniqueSeasons((data ?? []) as PublicPlayerReportRow[]);
  const totals = rows.reduce(
    (summary, row) => ({
      goals: summary.goals + Number(row.goals ?? 0)
    }),
    { goals: 0 }
  );

  return (
    <main className="min-h-screen">
      <PublicHeader returnHref={showReturnLink ? "/reports/payments" : undefined} returnLabel="Return to report" />
      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:py-8">
        <header className="panel overflow-hidden">
          <div className="grid gap-5 bg-white p-5 sm:p-6 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Players status
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">OU Soccer players status</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Shared read-only view for player balances, goals, assists, appearances, and recent attendance.
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 md:w-44">
              <Trophy className="mb-2 h-5 w-5 text-pitch" />
              <div className="text-xs font-medium text-emerald-700">Total goals</div>
              <div className="mt-1 text-2xl font-semibold text-ink">{totals.goals}</div>
            </div>
          </div>
        </header>

        <form className="panel grid gap-3 p-4 sm:grid-cols-[1fr_220px_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input w-full pl-9" defaultValue={filters.q ?? ""} name="q" placeholder="Search player" />
          </label>
          <select className="input" defaultValue={filters.season ?? ""} name="season">
            <option value="">All seasons</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>{season.name}</option>
            ))}
          </select>
          <button className="btn-primary">Filter</button>
        </form>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Public report is not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const status = balanceStatus(row);
            return (
              <article className={cn("rounded-lg border bg-white p-4 shadow-sm", status.cardClass)} key={`${row.player_id}-${row.season_id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-ink">{row.player_name ?? "Unknown player"}</h2>
                    <p className="mt-1 truncate text-xs font-medium text-slate-500">{row.season_name ?? "Season"}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold", status.badgeClass)}>
                    {status.label}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <StatBox label="Balance" value={money(Math.abs(numberValue(row.balance_amount)))} tone={status.tone} />
                  <StatBox label="Goals" value={String(row.goals ?? 0)} />
                  <StatBox label="Assists" value={String(row.assists ?? 0)} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <MiniMetric label="Paid" value={money(numberValue(row.total_paid_amount))} />
                  <MiniMetric label="Used" value={money(numberValue(row.estimated_used_amount))} />
                  <MiniMetric label="Played" value={String(row.appearances ?? row.total_played_sessions ?? 0)} />
                </div>
                <RecentSessions sessions={row.last_attended_sessions ?? []} />
              </article>
            );
          })}
        </section>

        {!rows.length && !error ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">No player report rows match this filter.</div>
        ) : null}
      </div>
    </main>
  );
}

function StatBox({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "credit" | "owes" | "neutral" }) {
  return (
    <div className={cn("rounded-md border p-2 text-center", toneClasses(tone).soft)}>
      <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
      <div className={cn("mt-1 text-base font-bold", toneClasses(tone).text)}>{value}</div>
    </div>
  );
}

function RecentSessions({ sessions }: { sessions: string[] }) {
  return (
    <div className="mt-3 rounded-md bg-slate-50 p-2 text-xs">
      <div className="font-semibold uppercase text-slate-500">Last 3 attended</div>
      {sessions.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sessions.map((session, index) => (
            <span className="rounded bg-white px-2 py-1 font-medium text-slate-700 ring-1 ring-slate-200" key={`${session}-${index}`}>
              {session}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-slate-500">No attended sessions yet.</p>
      )}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-2">
      <div className="font-medium text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function balanceStatus(row: PublicPlayerReportRow) {
  const balance = numberValue(row.balance_amount);
  if (balance < 0) {
    return {
      label: `Owes ${money(Math.abs(balance))}`,
      tone: "owes" as const,
      cardClass: "border-rose-200 bg-rose-50/45",
      badgeClass: "bg-rose-100 text-rose-800"
    };
  }
  if (balance > 0) {
    return {
      label: `Credit ${money(balance)}`,
      tone: "credit" as const,
      cardClass: "border-emerald-200 bg-emerald-50/45",
      badgeClass: "bg-emerald-100 text-emerald-800"
    };
  }
  return {
    label: "Settled",
    tone: "neutral" as const,
    cardClass: "border-line",
    badgeClass: "bg-slate-100 text-slate-700"
  };
}

function toneClasses(tone: "credit" | "owes" | "neutral") {
  if (tone === "credit") return { soft: "border-emerald-200 bg-emerald-50", text: "text-emerald-700" };
  if (tone === "owes") return { soft: "border-rose-200 bg-rose-50", text: "text-rose-700" };
  return { soft: "border-line bg-white", text: "text-slate-800" };
}

function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function uniqueSeasons(rows: PublicPlayerReportRow[]) {
  const seasons = new Map<string, string>();
  for (const row of rows) {
    if (row.season_id) seasons.set(row.season_id, row.season_name ?? "Season");
  }
  return Array.from(seasons.entries()).map(([id, name]) => ({ id, name }));
}
