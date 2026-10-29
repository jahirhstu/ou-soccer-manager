import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setProgramModule } from "@/lib/actions/admin";
import { getCurrentProfile } from "@/lib/supabase/server";
import { InvitationForm } from "@/components/InvitationForm";
import { hasOrganizationAdminAuthority } from "@/lib/organization-access";

export default async function ProgramsPage() {
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile();
  const organizationAdmin = await hasOrganizationAdminAuthority(supabase, profile?.organization_id);
  const { data } = await supabase
    .from("programs")
    .select("*,program_modules(module_key,enabled),program_members(id,profile_id,role,status)")
    .order("name");

  const rows = (data ?? []).map((program: any) => ({
    ...program,
    modules: program.program_modules ?? [],
    memberCount: program.program_members?.length ?? 0
  }));
  const managedPrograms = rows.filter((program: any) =>
    program.program_members?.some((member: any) => member.profile_id === profile?.id && member.role === "manager" && member.status === "active")
  ).map((program: any) => ({ id: program.id, name: program.name }));

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Programs</h1>
          <p className="text-sm text-slate-500">Manage sports, events, and recurring groups inside this organization.</p>
        </div>
        {organizationAdmin ? <Link className="btn-primary" href="/programs/new"><Plus className="h-4 w-4" /> New program</Link> : null}
      </div>

      <DataTable rows={rows} columns={[
        { header: "Name", cell: (row) => <span className="font-medium text-ink">{row.name}</span> },
        { header: "Category", cell: (row) => categoryLabel(row.category) },
        { header: "Activity type", cell: (row) => activityLabel(row.activity_type) },
        { header: "Modules", cell: (row) => <div className="flex max-w-md flex-wrap gap-1">{row.modules.map((module: any) => (
          organizationAdmin ? <form action={setProgramModule} key={module.module_key}>
            <input name="program_id" type="hidden" value={row.id} />
            <input name="module_key" type="hidden" value={module.module_key} />
            <input name="enabled" type="hidden" value={module.enabled ? "false" : "true"} />
            <button className={module.enabled ? "rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800" : "rounded bg-slate-100 px-2 py-1 text-xs text-slate-500"}>{activityLabel(module.module_key)}</button>
          </form> : <span className={module.enabled ? "rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800" : "rounded bg-slate-100 px-2 py-1 text-xs text-slate-500"} key={module.module_key}>{activityLabel(module.module_key)}</span>
        ))}</div> },
        { header: "Members", cell: (row) => row.memberCount },
        { header: "Status", cell: (row) => <StatusBadge status={row.status} /> }
      ]} />
      {managedPrograms.length && !organizationAdmin ? (
        <div className="mt-5">
          <InvitationForm programManagerMode programs={managedPrograms} />
        </div>
      ) : null}
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
