import Link from "next/link";
import { randomUUID } from "node:crypto";
import { CalendarClock, CircleDollarSign, CreditCard, ExternalLink, ReceiptText, TrendingDown, Trophy, Upload, Users, WalletCards, type LucideIcon } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { DashboardSeasonSelect } from "@/components/DashboardSeasonSelect";
import { ClubBalanceTransferForm } from "@/components/ClubBalanceTransferForm";
import { PaymentFlashToast } from "@/components/PaymentFlashToast";
import { reverseClubBalanceTransfer } from "@/lib/actions/club-transfers";
import { resolveDashboardSeason } from "@/lib/dashboard-seasons";
import { AppShell } from "../(shell)";
import { money } from "@/lib/utils";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";
import { createSupabaseServerClient, getCurrentProfile, getCurrentProgram } from "@/lib/supabase/server";

type DashboardSummaryRow = {
  season_id: string;
  total_paid_amount: number | string | null;
  estimated_used_amount: number | string | null;
  owes_money: number | string | null;
};
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ season?: string; success?: string }> }) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
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
    supabase.rpc("internal_scoped_player_report", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null }),
    supabase.rpc("admin_dashboard_season_finance", { p_season_id: activeSeason.id }),
    supabase.from("sessions").select("id", { count: "exact", head: true }).eq("season_id", activeSeason.id),
    supabase.from("sessions").select("session_date").eq("season_id", activeSeason.id).eq("status", "scheduled").gte("session_date", today).order("session_date").limit(1),
    supabase.rpc("admin_club_transfer_summary", { p_season_id: activeSeason.id }),
    supabase.from("club_balance_transfers").select("*").eq("organization_id", profile.organization_id)
      .or(`source_season_id.eq.${activeSeason.id},destination_season_id.eq.${activeSeason.id}`)
      .order("created_at", { ascending: false }),
    activeSeason.program_id
      ? supabase.from("club_expenses").select("id", { count: "exact", head: true })
        .eq("organization_id", profile.organization_id).eq("program_id", activeSeason.program_id).is("season_id", null)
      : supabase.from("club_expenses").select("id", { count: "exact", head: true })
        .eq("organization_id", profile.organization_id).is("program_id", null).is("season_id", null),
    supabase.rpc("admin_dashboard_current_club_balance", { p_season_id: activeSeason.id })
  ]);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  const [{ data: sessions }, { data: payments }, { data: stats }, { data: balances }, { data: summaries }, { data: financeRows }, { count: sessionCount }, { data: upcoming }, { data: transferSummaries }, { data: transferHistory }, { count: unassignedExpenses }, { data: currentBalanceRows }] = results;
  const finance = financeRows?.[0];
  if (!finance) throw new Error("Season financial summary is unavailable.");
  const currentBalance = currentBalanceRows?.[0]?.current_club_balance;
  if (currentBalance == null) throw new Error("Current club balance is unavailable.");
  const transferSummary = transferSummaries?.[0];
  if (!transferSummary) throw new Error("Club transfer summary is unavailable.");
  const destinations = (seasons ?? []).filter((season) => activeSeason.program_id && season.program_id === activeSeason.program_id
    && activeSeason.start_date && season.start_date && season.start_date > activeSeason.start_date);
  const seasonNames = new Map((seasons ?? []).map((season) => [season.id, season.name]));
  const reversedIds = new Set((transferHistory ?? []).map((row) => row.reverses_transfer_id).filter(Boolean));
  const summaryRows = (summaries ?? []) as DashboardSummaryRow[];
  const activeSummaries = activeSeason ? summaryRows.filter((row) => row.season_id === activeSeason.id) : summaryRows;
  const totalUsed = sumMoney(activeSummaries.map((row) => row.estimated_used_amount));
  const totalOwing = sumMoney(activeSummaries.map((row) => row.owes_money));

  return (
    <AppShell>
      <PaymentFlashToast success={filters.success} />
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
          <Metric icon={Users} label="Players" supportingText="Active players with attendance, payments, or balance activity this season." value={finance.player_count ?? 0} />
          <Metric icon={CalendarClock} label="Sessions" supportingText="All sessions recorded for this season, including upcoming sessions." value={sessionCount ?? 0} />
          <Metric icon={Trophy} label="Upcoming session" supportingText="The date of the next scheduled session." value={upcoming?.[0]?.session_date ?? "-"} />
          <Metric icon={CircleDollarSign} label="Price per session" supportingText="The standard fee for one session. Individual charges may differ." value={money(activeSeason?.price_per_session)} />
          <Metric icon={CreditCard} label="Signup collected" supportingText="Payments recorded without a specific session attached." value={money(finance.signup_collected)} />
          <Metric icon={CreditCard} label="Drop-in collected" supportingText="Payments recorded against a specific session." value={money(finance.drop_in_collected)} />
          <Metric icon={CreditCard} label="Total collected" supportingText="All player payments received this season, before expenses and refunds." value={money(finance.total_collected)} />
          <Metric icon={ReceiptText} label="Total expenses" supportingText="Recorded spending charged to this season, including applicable unassigned expenses." value={money(finance.total_expenses)} />
          <Metric icon={ReceiptText} label="Total refunded" supportingText="Money already returned to players." value={money(finance.total_refunded)} />
          <Metric icon={CircleDollarSign} label="Club balance" supportingText="Money collected plus transfers in, minus expenses, refunds, and transfers out. Includes money held for players." value={money(finance.club_balance)} />
          <Metric icon={CircleDollarSign} label="Current Club Balance" supportingText="Money left after setting aside unused player funds, excluding advance charges for upcoming sessions. A negative amount means a shortfall." value={money(currentBalance)} status={Number(currentBalance) < 0 ? "Shortfall" : undefined} />
          <Metric icon={CircleDollarSign} label="Projected Club Surplus" supportingText="Money left after setting aside player credit, including posted upcoming charges. Includes carried-forward money; this is not season profit." value={money(finance.net_club_balance)} />
          <Metric icon={ReceiptText} label="Total Waived" supportingText="Session fees forgiven for players. This is not money collected or spent." value={money(finance.total_waived)} />
          <Metric
            icon={WalletCards}
            label="Total Player Credit Remaining"
            supportingText="Player funds left after recorded charges, including advance charges for upcoming sessions."
            tooltip="The sum of all positive player balances. Amounts owed by players do not reduce this total."
            value={money(finance.total_player_credit)}
          />
          <Metric icon={TrendingDown} label="Net session charges" supportingText="Session fees charged after waivers, including posted upcoming fees. This is not payments received." value={money(totalUsed)} />
          <Metric icon={CircleDollarSign} label="Total owing" supportingText="Unpaid player charges, including posted upcoming fees. One player’s credit does not cancel another player’s debt." value={money(totalOwing)} />
        </div>
        <section className="grid gap-3">
          <h2 className="section-title">Club balance carry-forward</h2>
          <div className="grid gap-3 border-y border-line py-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div><span className="text-slate-500">Season result before transfers</span><div className="font-semibold text-ink">{money(transferSummary.season_result)}</div><p className="mt-1 text-xs text-slate-500">Season balance after player credit, before club transfers. Includes posted upcoming charges.</p></div>
            <div><span className="text-slate-500">Carried in</span><div className="font-semibold text-ink">{money(transferSummary.carried_in)}</div><p className="mt-1 text-xs text-slate-500">Signed balance transferred into this season. A negative amount brings in a shortfall.</p></div>
            <div><span className="text-slate-500">Carried out</span><div className="font-semibold text-ink">{money(transferSummary.carried_out)}</div><p className="mt-1 text-xs text-slate-500">Signed balance transferred out of this season. A negative amount moves out a shortfall.</p></div>
            <div><span className="text-slate-500">Balance remaining</span><div className="font-semibold text-ink">{money(transferSummary.balance_remaining)}</div><p className="mt-1 text-xs text-slate-500">Season balance after player credit and transfers, including posted upcoming charges.</p></div>
          </div>
          {unassignedExpenses ? <p className="text-sm text-amber-800">
            {unassignedExpenses} unassigned expense{unassignedExpenses === 1 ? "" : "s"} must be <Link className="underline" href="/expenses">assigned to a season</Link> before a transfer.
          </p> : null}
          <ClubBalanceTransferForm key={activeSeason.id} source={activeSeason} destinations={destinations}
            balance={transferSummary.balance_remaining} today={today} submissionId={randomUUID()}
            unassignedExpenses={unassignedExpenses ?? 0} />
          <h3 className="section-title">Transfer history</h3>
          <DataTable rows={transferHistory ?? []} columns={[
            { header: "Date", cell: (row) => row.transfer_date },
            { header: "From", cell: (row) => seasonNames.get(row.source_season_id) ?? "-" },
            { header: "To", cell: (row) => seasonNames.get(row.destination_season_id) ?? "-" },
            { header: "Amount", cell: (row) => money(row.amount) },
            { header: "Status", cell: (row) => row.reverses_transfer_id ? "Reversal" : reversedIds.has(row.id) ? "Reversed" : "Recorded" },
            { header: "Note", cell: (row) => row.note ?? "-" },
            { header: "Action", cell: (row) => !row.reverses_transfer_id && !reversedIds.has(row.id) ? (
              <form action={reverseClubBalanceTransfer} className="flex items-center gap-2">
                <input type="hidden" name="transfer_id" value={row.id} />
                <input type="hidden" name="season_id" value={activeSeason.id} />
                <input type="hidden" name="submission_id" value={randomUUID()} />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="confirmed" value="yes" required /> Confirm</label>
                <button className="btn-secondary" type="submit">Reverse</button>
              </form>
            ) : "-" }
          ]} />
        </section>
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
  status,
  value
}: {
  icon: LucideIcon;
  label: string;
  supportingText?: string;
  tooltip?: string;
  status?: string;
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
      {status ? <p className="mt-1 text-sm font-medium text-amber-800">{status}</p> : null}
      {supportingText ? <p className="mt-1 text-xs leading-5 text-slate-500">{supportingText}</p> : null}
    </div>
  );
}

function sumMoney(values: Array<number | string | null | undefined>): number {
  return values.reduce<number>((total, value) => total + Number(value ?? 0), 0);
}
