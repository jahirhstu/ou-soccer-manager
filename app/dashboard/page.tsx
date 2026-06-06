import Link from "next/link";
import { CalendarClock, CircleDollarSign, CreditCard, ExternalLink, ReceiptText, TrendingDown, Trophy, Upload, Users, type LucideIcon } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { AppShell } from "../(shell)";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type DashboardSummaryRow = {
  season_id: string;
  total_paid_amount: number | string | null;
  estimated_used_amount: number | string | null;
  owes_money: number | string | null;
};
type DashboardPaymentEntryRow = {
  amount: number | string | null;
  season_id: string;
  session_id: string | null;
};
type DashboardExpenseRow = {
  amount: number | string | null;
  season_id: string | null;
};

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: seasons }, { data: players }, { data: sessions }, { data: payments }, { data: stats }, { data: balances }, { data: summaries }, { data: paymentEntries }, { data: expenses }] = await Promise.all([
    supabase.from("seasons").select("*").eq("status", "active").limit(1),
    supabase.from("players").select("*").eq("status", "active"),
    supabase.from("sessions").select("*,playgrounds(name)").order("session_date", { ascending: false }).limit(5),
    supabase.from("payments").select("amount,payment_date,players(display_name)").gt("amount", 0).order("created_at", { ascending: false }).limit(5),
    supabase.from("player_season_stats_summary").select("player_id,player_name,goals,assists").order("goals", { ascending: false }).limit(5),
    supabase.from("player_season_payment_summary").select("player_id,player_name,remaining_sessions,credit_amount").gt("remaining_sessions", 0).limit(5),
    supabase.rpc("public_player_report"),
    supabase.from("ledger_entries").select("season_id,session_id,amount").eq("type", "payment_received").gt("amount", 0),
    supabase.from("club_expenses").select("season_id,amount")
  ]);
  const activeSeason = seasons?.[0];
  const summaryRows = (summaries ?? []) as DashboardSummaryRow[];
  const activeSummaries = activeSeason ? summaryRows.filter((row) => row.season_id === activeSeason.id) : summaryRows;
  const paymentRows = (paymentEntries ?? []) as DashboardPaymentEntryRow[];
  const expenseRows = (expenses ?? []) as DashboardExpenseRow[];
  const activePayments = activeSeason ? paymentRows.filter((row) => row.season_id === activeSeason.id) : paymentRows;
  const activeExpenses = activeSeason ? expenseRows.filter((row) => row.season_id === activeSeason.id || row.season_id == null) : expenseRows;
  const collectedFromReport = sumMoney(activeSummaries.map((row) => row.total_paid_amount));
  const signupCollectedFromEntries = sumMoney(activePayments.filter((row) => !row.session_id).map((row) => row.amount));
  const dropInCollectedFromEntries = sumMoney(activePayments.filter((row) => row.session_id).map((row) => row.amount));
  const totalCollectedFromEntries = signupCollectedFromEntries + dropInCollectedFromEntries;
  const signupCollected = totalCollectedFromEntries ? signupCollectedFromEntries : collectedFromReport;
  const dropInCollected = totalCollectedFromEntries ? dropInCollectedFromEntries : 0;
  const totalCollected = totalCollectedFromEntries || collectedFromReport;
  const totalUsed = sumMoney(activeSummaries.map((row) => row.estimated_used_amount));
  const totalOwing = sumMoney(activeSummaries.map((row) => row.owes_money));
  const totalExpenses = sumMoney(activeExpenses.map((row) => row.amount));
  const clubBalance = totalCollected - totalExpenses;

  return (
    <AppShell>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="text-sm text-slate-500">Active season: {activeSeason?.name ?? "No active season"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="btn-secondary" href="/public/report" rel="noopener noreferrer" target="_blank"><ExternalLink className="h-4 w-4" /> Report Gallery</Link>
            <Link className="btn-primary" href="/import-whatsapp"><Upload className="h-4 w-4" /> Import WhatsApp</Link>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Users} label="Players" value={players?.length ?? 0} />
          <Metric icon={CalendarClock} label="Sessions" value={sessions?.length ?? 0} />
          <Metric icon={Trophy} label="Upcoming session" value={sessions?.[0]?.session_date ?? "-"} />
          <Metric icon={CircleDollarSign} label="Price per session" value={money(activeSeason?.price_per_session)} />
          <Metric icon={CreditCard} label="Signup collected" value={money(signupCollected)} />
          <Metric icon={CreditCard} label="Drop-in collected" value={money(dropInCollected)} />
          <Metric icon={CreditCard} label="Total collected" value={money(totalCollected)} />
          <Metric icon={ReceiptText} label="Total expenses" value={money(totalExpenses)} />
          <Metric icon={CircleDollarSign} label="Club balance" value={money(clubBalance)} />
          <Metric icon={TrendingDown} label="Total charged(used)" value={money(totalUsed)} />
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

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-500">{label}</div>
        <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-50 text-pitch ring-1 ring-emerald-100">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 break-words text-2xl font-semibold tracking-tight text-ink">{value}</div>
    </div>
  );
}

function sumMoney(values: Array<number | string | null | undefined>): number {
  return values.reduce<number>((total, value) => total + Number(value ?? 0), 0);
}
