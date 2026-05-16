import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { money } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PaymentsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("payments").select("*,players(display_name),seasons(name)").order("payment_date", { ascending: false });
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Payments</h1>
        <Link className="btn-primary" href="/payments/new"><Plus className="h-4 w-4" /> Record payment</Link>
      </div>
      <DataTable rows={data ?? []} columns={[
        { header: "Player", cell: (row: any) => row.players?.display_name ?? "-" },
        { header: "Season", cell: (row: any) => row.seasons?.name ?? "-" },
        { header: "Date", cell: (row) => row.payment_date },
        { header: "Amount", cell: (row) => money(row.amount) },
        { header: "Paid sessions", cell: (row) => row.sessions_covered ?? "-" },
        { header: "Method", cell: (row) => row.payment_method ?? "-" }
      ]} />
    </AppShell>
  );
}
