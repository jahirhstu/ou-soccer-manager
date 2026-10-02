import Link from "next/link";
import { CalendarClock, CircleDollarSign, CreditCard, ExternalLink, ReceiptText, TrendingDown, Trophy, Upload, Users, WalletCards, type LucideIcon } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { DashboardSeasonSelect } from "@/components/DashboardSeasonSelect";
import { resolveDashboardSeason } from "@/lib/dashboard-seasons";
import { AppShell } from "../(shell)";
import { money } from "@/lib/utils";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";

type DashboardSummaryRow = {
  season_id: string;
  total_paid_amount: number | string | null;
  estimated_used_amount: number | string | null;
  owes_money: number | string | null;
};
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [program, profile] = await Promise.all([getCurrentProgram(), getCurrentProfile()]);
  let seasonQuery = supabase.from("seasons").select("*").eq("organization_id", profile?.organization_id)
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false }).order("id");
  if (program?.id) seasonQuery = seasonQuery.eq("program_id", program.id);
  const { data: seasons, error: seasonError } = await seasonQuery;
  if (seasonError) throw new Error(seasonError.message);
  const activeSeason = resolveDashboardSeason(seasons ?? [], filters.season);
  if (!activeSeason) return <AppShell><h1 className="page-title">Dashboard</h1><p className="mt-4 text-sm text-slate-600">No seasons configured.</p></AppShell>;
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const results = await Promise.all([
    supabase.from("sessions").select("*,playgrounds(name)").eq("season_id", activeSeason.id).order("session_date", { ascending: false }).limit(5),
    supabase.from("payments").select("amount,payment_date,players(display_name)").eq("season_id", activeSeason.id).gt("amount", 0).order("created_at", { ascending: false }).limit(5),
    supabase.from("player_season_stats_summary").select("player_id,player_name,goals,assists").eq("season_id", activeSeason.id).order("goals", { ascending: false }).limit(5),
    supabase.from("player_season_payment_summary").select("player_id,player_name,remaining_sessions,credit_amount").eq("season_id", activeSeason.id).gt("credit_amount", 0).limit(5),
    supabase.rpc("public_player_report"),
    supabase.rpc("admin_dashboard_season_finance", { p_season_id: activeSeason.id }),
    supabase.from("sessions").select("id", { count: "exact", head: true }).eq("season_id", activeSeason.id),
    supabase.from("sessions").select("session_date").eq("season_id", activeSeason.id).eq("status", "scheduled").gte("session_date", today).order("session_date").limit(1)
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  const [{ data: sessions }, { data: payments }, { data: stats }, { data: balances }, { data: summaries }, { data: financeRows }, { count: sessionCount }, { data: upcoming }] = results;
  const finance = financeRows?.[0];
  if (!finance) throw new Error("Season financial summary is unavailable.");
  const summaryRows = (summaries ?? []) as DashboardSummaryRow[];
  const activeSummaries = activeSeason ? summaryRows.filter((row) => row.season_id === activeSeason.id) : summaryRows;
  const totalUsed = sumMoney(activeSummaries.map((row) => row.estimated_used_amount));
  const totalOwing = sumMoney(activeSummaries.map((row) => row.owes_money));

  return (
    <AppShell>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="text-sm text-slate-500">Season: {activeSeason.name}{activeSeason.status === "active" ? " (Active)" : ""}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <DashboardSeasonSelect seasons={seasons ?? []} selectedId={activeSeason.id} />
            <Link className="btn-secondary" href="/public/report" rel="noopener noreferrer" target="_blank"><ExternalLink className="h-4 w-4" /> Report Gallery</Link>
            <Link className="btn-primary" href="/import-whatsapp"><Upload className="h-4 w-4" /> Import WhatsApp</Link>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Users} label="Players" value={finance.player_count ?? 0} />
          <Metric icon={CalendarClock} label="Sessions" value={sessionCount ?? 0} />
          <Metric icon={Trophy} label="Upcoming session" value={upcoming?.[0]?.session_date ?? "-"} />
          <Metric icon={CircleDollarSign} label="Price per session" value={money(activeSeason?.price_per_session)} />
          <Metric icon={CreditCard} label="Signup collected" value={money(finance.signup_collected)} />
          <Metric icon={CreditCard} label="Drop-in collected" value={money(finance.drop_in_collected)} />
          <Metric icon={CreditCard} label="Total collected" value={money(finance.total_collected)} />
          <Metric icon={ReceiptText} label="Total expenses" value={money(finance.total_expenses)} />
          <Metric icon={ReceiptText} label="Total refunded" value={money(finance.total_refunded)} />
          <Metric icon={CircleDollarSign} label="Club balance" value={money(finance.club_balance)} />
          <Metric icon={CircleDollarSign} label="Net Club Balance" supportingText="Club balance after unused player credit" value={money(finance.net_club_balance)} />
          <Metric icon={ReceiptText} label="Total Waived" supportingText="Session fees forgiven this season" value={money(finance.total_waived)} />
          <Metric
            icon={WalletCards}
            label="Total Player Credit Remaining"
            supportingText="Unused player funds currently held by the club"
            tooltip="The sum of all positive player balances. Amounts owed by players do not reduce this total."
            value={money(finance.total_player_credit)}
          />
          <Metric icon={TrendingDown} label="Net session charges" value={money(totalUsed)} />
          <Metric icon={CircleDollarSign} label="Total owing" value={money(totalOwing)} />
        </div>
        <section className="grid gap-3">
          <h2 className="section-title">Recent sessions</h2>
          <DataTable compact rows={sessions ?? []} columns={[
            { header: "Date", cell: (row) => row.session_date },
            { header: "Playground", cell: (row: any) => row.playgrounds?.name ?? row.location ?? "-" },
            { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
          ]} />
        </section>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="grid gap-3">
            <h2 className="section-title">Recent payments</h2>
            <DataTable compact rows={payments ?? []} columns={[
              { header: "Player", cell: (row: any) => row.players?.display_name ?? "-" },
              { header: "Date", cell: (row) => row.payment_date },
              { header: "Amount", cell: (row) => money(row.amount) }
            ]} />
          </section>
          <section className="grid gap-3">
            <h2 className="section-title">Top scorers</h2>
            <DataTable compact rows={stats ?? []} columns={[
              { header: "Player", cell: (row) => row.player_name ?? "-" },
              { header: "Goals", cell: (row) => row.goals ?? 0 },
              { header: "Assists", cell: (row) => row.assists ?? 0 }
            ]} />
          </section>
        </div>
        <section className="grid gap-3">
          <h2 className="section-title">Players with credit</h2>
          <DataTable compact rows={balances ?? []} columns={[
            { header: "Player", cell: (row) => row.player_name ?? "-" },
            { header: "Remaining sessions", cell: (row) => row.remaining_sessions ?? 0 },
            { header: "Credit", cell: (row) => money(row.credit_amount) }
          ]} />
        </section>
      </div>
    </AppShell>
  );
}

function Metric({
  icon: Icon,
  label,
  supportingText,
  tooltip,
  value
}: {
  icon: LucideIcon;
  label: string;
  supportingText?: string;
  tooltip?: string;
  value: string | number;
}) {
  return (
    <div className="panel p-4" title={tooltip}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-500">{label}</div>
        <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-50 text-pitch ring-1 ring-emerald-100">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 break-words text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {supportingText ? <p className="mt-1 text-xs leading-5 text-slate-500">{supportingText}</p> : null}
    </div>
  );
}

function sumMoney(values: Array<number | string | null | undefined>): number {
  return values.reduce<number>((total, value) => total + Number(value ?? 0), 0);
}
