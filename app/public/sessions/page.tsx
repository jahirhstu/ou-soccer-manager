import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { PublicShell } from "@/components/PublicShell";
import { StatusBadge } from "@/components/StatusBadge";
import { hasPermission } from "@/lib/permissions";
import { compareNumberAsc, compareText } from "@/lib/sorting";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { getRequestProgramSlug, getRequestTenantSlug } from "@/lib/tenant-server";
import { money } from "@/lib/utils";

type PublicSessionRow = {
  id: string;
  name: string | null;
  session_date: string;
  season_name: string | null;
  playground_name: string | null;
  location: string | null;
  price_per_session: number | string | null;
  status: string | null;
};

type SortKey = "date_desc" | "date_asc" | "name" | "season" | "field" | "status" | "price";

export default async function PublicSessionsPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const supabase = await createSupabaseServerClient();
  const tenantSlug = await getRequestTenantSlug();
  const programSlug = await getRequestProgramSlug();
  const [{ data, error }, profile] = await Promise.all([
    supabase.rpc("scoped_public_sessions", { p_organization_slug: tenantSlug, p_program_slug: programSlug || null }),
    getCurrentProfile()
  ]);
  const showReturnLink = hasPermission(profile?.role, "manage_attendance");
  const rows = sortRows((data ?? []) as PublicSessionRow[], sortKey(filters.sort));

  return (
    <PublicShell returnHref={showReturnLink ? "/dashboard" : undefined} returnLabel="Return">
      <div className="grid gap-5">
        <header className="panel overflow-hidden">
          <div className="bg-pitch px-5 py-6 text-white sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-md bg-white/15 px-3 py-1 text-xs font-semibold text-emerald-50 ring-1 ring-white/20">
              <CalendarDays className="h-3.5 w-3.5" />
              Public sessions
            </span>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Sessions</h1>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50">
              Read-only session list with teams, attendance, game scores, goals, and assists.
            </p>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Public sessions are not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <DataTable
          rows={rows}
          columns={[
            { header: "Date", cell: (row) => <Link className="font-medium text-pitch" href={`/public/sessions/${row.id}`}>{row.session_date}</Link> },
            { header: "Name", cell: (row) => row.name ?? "-" },
            { header: "Season", cell: (row) => row.season_name ?? "-" },
            { header: "Playground", cell: (row) => row.playground_name ?? row.location ?? "-" },
            { header: "Price", cell: (row) => row.price_per_session == null ? "Season default" : money(numberValue(row.price_per_session)) },
            { header: "Status", cell: (row) => row.status ? <StatusBadge status={row.status} /> : "-" }
          ]}
          empty={error ? "No sessions available until the migration is applied." : "No sessions yet."}
        />
      </div>
    </PublicShell>
  );
}

function numberValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sortKey(value: string | undefined): SortKey {
  if (value === "date_asc" || value === "name" || value === "season" || value === "field" || value === "status" || value === "price") return value;
  return "date_desc";
}

function sortRows(rows: PublicSessionRow[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "date_asc") return compareText(left.session_date, right.session_date) || compareText(left.name, right.name);
    if (key === "name") return compareText(left.name, right.name) || compareText(right.session_date, left.session_date);
    if (key === "season") return compareText(left.season_name, right.season_name) || compareText(right.session_date, left.session_date);
    if (key === "field") return compareText(left.playground_name ?? left.location, right.playground_name ?? right.location) || compareText(right.session_date, left.session_date);
    if (key === "status") return compareText(left.status, right.status) || compareText(right.session_date, left.session_date);
    if (key === "price") return compareNumberAsc(left.price_per_session, right.price_per_session) || compareText(right.session_date, left.session_date);
    return compareText(right.session_date, left.session_date) || compareText(left.name, right.name);
  });
}
