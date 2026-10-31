import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { compareText } from "@/lib/sorting";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/permissions";
import { EditablePlayerField } from "@/components/EditablePlayerField";
import type { Player } from "@/lib/types";

type SortKey = "name" | "status" | "position" | "email";

export default async function PlayersPage({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const filters = await searchParams;
  const [supabase, profile] = await Promise.all([createSupabaseServerClient(), getCurrentProfile()]);
  const data: Player[] = [];
  let loadError: string | null = null;
  if (!profile?.organization_id) {
    loadError = "No organization found for this account.";
  } else {
    for (let offset = 0; ; offset += 500) {
      const result = await supabase.from("players").select("*")
        .eq("organization_id", profile.organization_id)
        .order("display_name").order("id")
        .range(offset, offset + 499);
      if (result.error) {
        loadError = result.error.message;
        break;
      }
      const batch = (result.data ?? []) as Player[];
      data.push(...batch);
      if (batch.length < 500) break;
    }
  }
  const rows = sortRows(loadError ? [] : data, sortKey(filters.sort));
  const canEdit = hasPermission(profile?.role, "manage_finance");
  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Players</h1>
        <Link className="btn-primary" href="/players/new"><Plus className="h-4 w-4" /> New player</Link>
      </div>
      {loadError ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">Could not load players: {loadError}</p> : null}
      <DataTable empty={loadError ? "Could not load players." : "No players found in this organization."} rows={rows} columns={[
        { header: "Name", cell: (row) => <Link className="font-medium text-pitch" href={`/players/${row.id}`}>{row.display_name}</Link> },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        { header: "Phone", cell: (row) => <EditablePlayerField canEdit={canEdit} field="phone" playerId={row.id} playerName={row.display_name} value={row.phone} /> },
        { header: "Email", cell: (row) => <EditablePlayerField canEdit={canEdit} field="email" playerId={row.id} playerName={row.display_name} value={row.email} /> },
        { header: "Default position", cell: (row) => <EditablePlayerField canEdit={canEdit} field="preferred_position" playerId={row.id} playerName={row.display_name} value={row.preferred_position} /> }
      ]} />
    </AppShell>
  );
}

function sortKey(value: string | undefined): SortKey {
  if (value === "status" || value === "position" || value === "email") return value;
  return "name";
}

function sortRows(rows: Player[], key: SortKey) {
  return [...rows].sort((left, right) => {
    if (key === "status") return compareText(left.status, right.status) || compareText(left.display_name, right.display_name);
    if (key === "position") return compareText(left.preferred_position, right.preferred_position) || compareText(left.display_name, right.display_name);
    if (key === "email") return compareText(left.email, right.email) || compareText(left.display_name, right.display_name);
    return compareText(left.display_name, right.display_name);
  });
}
