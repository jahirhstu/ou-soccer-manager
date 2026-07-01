import { redirect } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { markNotificationRead } from "@/lib/actions/notifications";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { money } from "@/lib/utils";
import { AppShell } from "../(shell)";

type NotificationRow = {
  id: string;
  amount: number | string;
  message: string;
  read_at: string | null;
  created_at: string;
  player?: { display_name?: string | null } | null;
  season?: { name?: string | null } | null;
};

export default async function NotificationsPage() {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all")) redirect("/public/report");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("payment_notifications")
    .select("id,amount,message,read_at,created_at,player:players(display_name),season:seasons(name)")
    .order("read_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as NotificationRow[];
  const unreadCount = rows.filter((row) => !row.read_at).length;

  return (
    <AppShell>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="page-title">Notifications</h1>
            <p className="mt-1 text-sm text-slate-500">Payment sent alerts from the public player status page.</p>
          </div>
          <span className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            {unreadCount} unread
          </span>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Notifications are not ready yet. Run the latest database migration, then refresh this page.
          </div>
        ) : null}

        <DataTable
          empty="No notifications yet."
          rows={rows}
          columns={[
            { header: "Status", cell: (row) => <StatusPill read={Boolean(row.read_at)} /> },
            { header: "Message", cell: (row) => <span className="font-medium text-ink">{row.message}</span> },
            { header: "Player", cell: (row) => row.player?.display_name ?? "-" },
            { header: "Season", cell: (row) => row.season?.name ?? "-" },
            { header: "Amount", cell: (row) => money(Number(row.amount)) },
            { header: "Created", cell: (row) => formatDateTime(row.created_at) },
            {
              header: "Action",
              cell: (row) => row.read_at ? (
                <span className="text-xs font-semibold text-slate-500">Read {formatDateTime(row.read_at)}</span>
              ) : (
                <form action={markNotificationRead}>
                  <input name="notificationId" type="hidden" value={row.id} />
                  <button className="btn-secondary min-h-9 px-3 text-xs">
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark read
                  </button>
                </form>
              )
            }
          ]}
        />
      </div>
    </AppShell>
  );
}

function StatusPill({ read }: { read: boolean }) {
  return (
    <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${read ? "bg-slate-100 text-slate-700" : "bg-rose-100 text-rose-800"}`}>
      {read ? "Read" : "Unread"}
    </span>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto"
  }).format(new Date(value));
}
