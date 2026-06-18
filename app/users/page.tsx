import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { UserUpdateForm } from "@/components/UserUpdateForm";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();
  const profile = await getCurrentProfile();
  const isAdmin = hasPermission(profile?.role, "manage_all");

  if (!isAdmin || !profile?.organization_id) {
    return (
      <AppShell>
        <div className="panel border-dashed p-10 text-center text-sm text-slate-500">Only admins can manage users.</div>
      </AppShell>
    );
  }

  const [{ data: members }, { data: players }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("id,role,player_id,profiles(id,display_name,email)")
      .eq("organization_id", profile.organization_id)
      .order("created_at"),
    supabase.from("players").select("id,display_name").order("display_name")
  ]);

  const rows = (members ?? []).map((member: any) => ({
    ...member,
    profile: Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
  }));

  return (
    <AppShell>
      <div className="grid gap-5">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="mt-1 text-sm text-slate-500">Map app users to player profiles and manage organization roles.</p>
        </div>

        <DataTable rows={rows} columns={[
          {
            header: "User",
            cell: (row) => (
              <div>
                <div className="font-medium text-ink">{row.profile?.display_name ?? "Unnamed user"}</div>
                <div className="text-xs text-slate-500">{row.profile?.email ?? "-"}</div>
              </div>
            )
          },
          {
            header: "Role",
            cell: (row) => (
              <UserUpdateForm memberId={row.id} playerId={row.player_id} players={players ?? []} role={row.role} />
            )
          }
        ]} />
      </div>
    </AppShell>
  );
}
