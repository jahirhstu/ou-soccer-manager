import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { hasPermission } from "@/lib/permissions";
import { money } from "@/lib/utils";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

export default async function SessionsPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data }, profile] = await Promise.all([
    supabase.from("sessions").select("*,seasons(name),playgrounds(name)").order("session_date", { ascending: false }),
    getCurrentProfile()
  ]);
  const isAdmin = hasPermission(profile?.role, "manage_all");
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Sessions</h1>
        {isAdmin ? <Link className="btn-primary" href="/sessions/new"><Plus className="h-4 w-4" /> New session</Link> : null}
      </div>
      <DataTable rows={data ?? []} columns={[
        { header: "Date", cell: (row) => <Link className="font-medium text-pitch" href={`/sessions/${row.id}`}>{row.session_date}</Link> },
        { header: "Name", cell: (row) => row.name ?? "-" },
        { header: "Season", cell: (row: any) => row.seasons?.name ?? "-" },
        { header: "Playground", cell: (row: any) => row.playgrounds?.name ?? row.location ?? "-" },
        { header: "Price", cell: (row) => row.price_per_session == null ? "Season default" : money(row.price_per_session) },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
      ]} />
    </AppShell>
  );
}
