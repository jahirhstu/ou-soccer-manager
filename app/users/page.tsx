import { AppShell } from "../(shell)";
import { DataTable } from "@/components/DataTable";
import { updateOrganizationUser } from "@/lib/actions/admin";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";

const roleOptions = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "captain", label: "Captain" },
  { value: "player", label: "Player" }
];

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
              <form action={updateOrganizationUser} className="grid gap-2">
                <input name="member_id" type="hidden" value={row.id} />
                <select className="input min-h-9 px-2 text-sm" defaultValue={row.role} name="role">
                  {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                </select>
                <select className="input min-h-9 px-2 text-sm" defaultValue={row.player_id ?? ""} name="player_id">
                  <option value="">No player mapping</option>
                  {(players ?? []).map((player) => <option key={player.id} value={player.id}>{player.display_name}</option>)}
                </select>
                <button className="btn-secondary min-h-9 w-fit px-3 text-xs">Update</button>
              </form>
            )
          }
        ]} />
      </div>
    </AppShell>
  );
}
