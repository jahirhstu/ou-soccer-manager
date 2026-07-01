import type { ReactNode } from "react";
import { Flame, Handshake, Search, ShieldCheck, TrendingDown, Trophy } from "lucide-react";
import { PublicShell } from "@/components/PublicShell";
import { PaymentSentButton } from "@/components/PaymentSentButton";
import { hasPermission } from "@/lib/permissions";
import { compareNumberDesc, compareText, numberValue } from "@/lib/sorting";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { cn, money } from "@/lib/utils";

type PublicPlayerReportRow = {
  player_id: string;
  player_name: string | null;
  season_id: string;
  season_name: string | null;
  total_paid_amount: number | string | null;
  total_played_sessions: number | string | null;
  confirmed_sessions?: number | string | null;
  estimated_used_amount: number | string | null;
  balance_amount: number | string | null;
  goals: number | null;
  assists: number | null;
  appearances: number | null;
  last_attended_sessions: string[] | null;
  latest_session?: string | null;
  upcoming_session?: string | null;
};

type PublicHighlightRow = {
  metric: "latest_winner" | "top_scorer" | "top_assist";
  player_name: string | null;
  team_name: string | null;
  captain_name: string | null;
  value: number | null;
  session_name: string | null;
  session_date: string | null;
  score: string | null;
};

type PublicPlayerStreakRow = {
  streak_type: "winning" | "losing";
  player_id: string;
  player_name: string | null;
  season_id: string;
  season_name: string | null;
  streak_count: number | string | null;
  start_session_date: string | null;
  end_session_date: string | null;
  session_names: string[] | null;
};

type PaymentNotificationKey = {
  player_id: string;
  season_id: string;
  amount: number | string;
};

type SortKey = "name" | "balance" | "goals" | "assists" | "played" | "season";

export default async function PublicPlayerReportPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; season?: string; sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: highlightsData, error: highlightsError }, { data: streaksData, error: streaksError }, { data: notificationKeys }, profile] = await Promise.all([
    supabase.rpc("public_player_report"),
    supabase.rpc("public_dashboard_highlights", { p_season_id: filters.season || null }),
    supabase.rpc("public_player_session_streaks", { p_season_id: filters.season || null }),
    supabase.rpc("public_payment_notification_keys"),
    getCurrentProfile()
  ]);
  const rows = sortRows(((data ?? []) as PublicPlayerReportRow[]).filter((row) => {
    if (filters.q && !String(row.player_name ?? "").toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.season && row.season_id !== filters.season) return false;
    return true;
  }), sortKey(filters.sort));
  const showReturnLink = hasPermission(profile?.role, "manage_attendance");
  const seasons = uniqueSeasons((data ?? []) as PublicPlayerReportRow[]);
  const highlights = ((highlightsData ?? []) as PublicHighlightRow[]).reduce((map, row) => map.set(row.metric, row), new Map<PublicHighlightRow["metric"], PublicHighlightRow>());
  const topScorer = highlights.get("top_scorer");
  const topAssist = highlights.get("top_assist");
  const latestWinner = highlights.get("latest_winner");
  const streakRows = (streaksData ?? []) as PublicPlayerStreakRow[];
  const topWinningStreak = streakRows.find((row) => row.streak_type === "winning");
  const topLosingStreak = streakRows.find((row) => row.streak_type === "losing");
  const notifiedBalances = new Set(((notificationKeys ?? []) as PaymentNotificationKey[]).map(notificationKey));

  return (
    <PublicShell returnHref={showReturnLink ? "/dashboard" : undefined} returnLabel="Return">
      <div className="grid gap-5">
        <header className="panel overflow-hidden">
          <div className="grid gap-4 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5" />
                Report Gallery
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <SummaryCard
                icon={<Trophy className="h-5 w-5 text-amber-600" />}
                label={topScorer?.score === "joint_top_scorer" ? "Joint top scorer" : "Top scorer"}
                subLabel={topScorer ? `${topScorer.value ?? 0} goals | ${topScorer.team_name ?? "No team"}` : "No goals yet"}
                value={topScorer?.player_name ?? "-"}
              />
              <SummaryCard
                icon={<Handshake className="h-5 w-5 text-pitch" />}
                label={topAssist?.score === "joint_top_assister" ? "Joint top assister" : "Top assist"}
                subLabel={topAssist ? `${topAssist.value ?? 0} assists | ${topAssist.team_name ?? "No team"}` : "No assists yet"}
                value={topAssist?.player_name ?? "-"}
              />
              <SummaryCard
                icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />}
                label="Latest winner"
                subLabel={highlightsError ? "Run latest migration" : latestWinner ? `${latestWinner.score ?? "-"} | Captain: ${latestWinner.captain_name ?? "-"}` : "No scored session"}
                value={latestWinner?.team_name ?? "-"}
              />
              <SummaryCard
                icon={<Flame className="h-5 w-5 text-amber-600" />}
                label="Winning streak"
                subLabel={streaksError ? "Run latest migration" : topWinningStreak ? `${numberValue(topWinningStreak.streak_count)} sessions | ${topWinningStreak.season_name ?? "Season"}` : "No streaks yet"}
                value={topWinningStreak?.player_name ?? "-"}
              />
              <SummaryCard
                icon={<TrendingDown className="h-5 w-5 text-rose-600" />}
                label="Losing streak"
                subLabel={streaksError ? "Run latest migration" : topLosingStreak ? `${numberValue(topLosingStreak.streak_count)} sessions | ${topLosingStreak.season_name ?? "Season"}` : "No streaks yet"}
                value={topLosingStreak?.player_name ?? "-"}
              />
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
            const owedAmount = status.tone === "owes" ? Math.abs(numberValue(row.balance_amount)) : 0;
            const paymentAlreadySent = owedAmount > 0 && notifiedBalances.has(notificationKey({ player_id: row.player_id, season_id: row.season_id, amount: owedAmount }));
            return (
              <article className={cn("rounded-lg border bg-white p-4 shadow-sm", status.cardClass)} key={`${row.player_id}-${row.season_id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-ink">{row.player_name ?? "Unknown player"}</h2>
                    <p className="mt-1 truncate text-xs font-medium text-slate-500">{row.season_name ?? "Season"}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <span className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", status.badgeClass)}>
                      {status.label}
                    </span>
                    {owedAmount > 0 ? (
                      <PaymentSentButton
                        amount={money(owedAmount)}
                        compact
                        disabled={paymentAlreadySent}
                        playerId={row.player_id}
                        seasonId={row.season_id}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <StatBox label="Balance" value={money(Math.abs(numberValue(row.balance_amount)))} tone={status.tone} />
                  <StatBox label="Goals" value={String(row.goals ?? 0)} />
                  <StatBox label="Assists" value={String(row.assists ?? 0)} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <MiniMetric label="Paid" value={money(numberValue(row.total_paid_amount))} />
                  <MiniMetric label="Used" value={money(numberValue(row.estimated_used_amount))} />
                  <MiniMetric label="Played" value={String(row.appearances ?? row.total_played_sessions ?? 0)} />
                  <MiniMetric label="Confirmed" value={String(numberValue(row.confirmed_sessions))} />
                </div>
                <SessionStatus
                  latestSession={row.latest_session ?? row.last_attended_sessions?.[0] ?? null}
                  upcomingSession={row.upcoming_session ?? null}
                />
              </article>
            );
          })}
        </section>

        {!rows.length && !error ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">No player report rows match this filter.</div>
        ) : null}
      </div>
    </PublicShell>
  );
}

function SummaryCard({ icon, label, subLabel, value }: { icon: ReactNode; label: string; subLabel: string; value: string }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      {icon}
      <div className="mt-2 text-xs font-medium text-emerald-700">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-ink" title={value}>{value}</div>
      <div className="mt-1 truncate text-xs font-medium text-emerald-800" title={subLabel}>{subLabel}</div>
    </div>
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

function SessionStatus({
  latestSession,
  upcomingSession
}: {
  latestSession: string | null;
  upcomingSession: string | null;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-2 text-xs">
      <div className="min-w-0 text-left">
        <div className="font-semibold uppercase text-slate-500">Latest session</div>
        <div className="mt-1 truncate font-semibold text-slate-800" title={latestSession ?? "No attended sessions yet"}>
          {latestSession ?? "None yet"}
        </div>
      </div>
      <div className="min-w-0 text-right">
        <div className="font-semibold uppercase text-slate-500">Upcoming session</div>
        <div className="mt-1 truncate font-semibold text-slate-800" title={upcomingSession ?? "No upcoming session"}>
          {upcomingSession ?? "None scheduled"}
        </div>
      </div>
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

function uniqueSeasons(rows: PublicPlayerReportRow[]) {
  const seasons = new Map<string, string>();
  for (const row of rows) {
    if (row.season_id) seasons.set(row.season_id, row.season_name ?? "Season");
  }
  return Array.from(seasons.entries()).map(([id, name]) => ({ id, name }));
}

function notificationKey(row: PaymentNotificationKey) {
  return `${row.player_id}:${row.season_id}:${Number(row.amount).toFixed(2)}`;
}

function sortKey(value: string | undefined): SortKey {
  if (value === "balance" || value === "goals" || value === "assists" || value === "played" || value === "season") return value;
  return "name";
}

function sortRows(rows: PublicPlayerReportRow[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "balance") return compareNumberDesc(left.balance_amount, right.balance_amount) || compareText(left.player_name, right.player_name);
    if (key === "goals") return compareNumberDesc(left.goals, right.goals) || compareText(left.player_name, right.player_name);
    if (key === "assists") return compareNumberDesc(left.assists, right.assists) || compareText(left.player_name, right.player_name);
    if (key === "played") return compareNumberDesc(left.appearances ?? left.total_played_sessions, right.appearances ?? right.total_played_sessions) || compareText(left.player_name, right.player_name);
    if (key === "season") return compareText(left.season_name, right.season_name) || compareText(left.player_name, right.player_name);
    return compareText(left.player_name, right.player_name) || compareText(left.season_name, right.season_name);
  });
}
