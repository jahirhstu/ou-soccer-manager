import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setProgramModule } from "@/lib/actions/admin";

export default async function ProgramsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("programs")
    .select("*,program_modules(module_key,enabled),program_members(id)")
    .order("name");

  const rows = (data ?? []).map((program: any) => ({
    ...program,
    modules: program.program_modules ?? [],
    memberCount: program.program_members?.length ?? 0
  }));

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Programs</h1>
          <p className="text-sm text-slate-500">Manage sports, events, and recurring groups inside this organization.</p>
        </div>
        <Link className="btn-primary" href="/programs/new"><Plus className="h-4 w-4" /> New program</Link>
      </div>

      <DataTable rows={rows} columns={[
        { header: "Name", cell: (row) => <span className="font-medium text-ink">{row.name}</span> },
        { header: "Category", cell: (row) => categoryLabel(row.category) },
        { header: "Activity type", cell: (row) => activityLabel(row.activity_type) },
        { header: "Modules", cell: (row) => <div className="flex max-w-md flex-wrap gap-1">{row.modules.map((module: any) => (
          <form action={setProgramModule} key={module.module_key}>
            <input name="program_id" type="hidden" value={row.id} />
            <input name="module_key" type="hidden" value={module.module_key} />
            <input name="enabled" type="hidden" value={module.enabled ? "false" : "true"} />
            <button className={module.enabled ? "rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800" : "rounded bg-slate-100 px-2 py-1 text-xs text-slate-500"}>{activityLabel(module.module_key)}</button>
          </form>
        ))}</div> },
        { header: "Members", cell: (row) => row.memberCount },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
      ]} />
    </AppShell>
  );
}

function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    event: "Event",
    generic: "Generic",
    social: "Social",
    sport: "Sport"
  };
  return labels[value] ?? value;
}

function activityLabel(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}
