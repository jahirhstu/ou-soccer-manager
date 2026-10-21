import { redirect } from "next/navigation";
import { CheckCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { markNotificationRead } from "@/lib/actions/notifications";
import { hasPermission } from "@/lib/permissions";
import { createSupabaseServerClient, getCurrentProfile } from "@/lib/supabase/server";
import { money } from "@/lib/utils";
import { AppShell } from "../(shell)";
import { notificationList, notificationSorts, type NotificationRow } from "@/lib/notification-list";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile?.role, "manage_all")) redirect("/public/report");

  const supabase = await createSupabaseServerClient();
  const params = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const rows: NotificationRow[] = [];
  let error = null;
  // Fetch in bounded batches so the API row limit cannot truncate filtering or totals.
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("notifications")
      .select("id,amount,message,read_at,created_at,season_id,player:players(display_name),season:seasons(name)")
      .order("id").range(offset, offset + 499);
    if (result.error) { error = result.error; break; }
    const batch = (result.data ?? []) as NotificationRow[];
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  const list = notificationList(error ? [] : rows, params);
  const seasons = Array.from(new Map(rows.map(row => [row.season_id, row.season?.name ?? "Unknown season"])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const href = (changes: Record<string, string>) => {
    const query = new URLSearchParams();
    for (const key of ["player", "message", "season", "status", "sort", "direction", "size", "page"]) {
      if (params[key]) query.set(key, params[key]!);
    }
    for (const [key, value] of Object.entries(changes)) query.set(key, value);
    return `?${query}`;
  };
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

        <form className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <label className="grid gap-1 text-sm">Player<input className="input" name="player" defaultValue={params.player} placeholder="Search player name" /></label>
          <label className="grid gap-1 text-sm">Message<input className="input" name="message" defaultValue={params.message} placeholder="Search message text" /></label>
          <label className="grid gap-1 text-sm">Season<select className="input" name="season" defaultValue={params.season ?? ""}><option value="">All seasons</option>{seasons.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Status<select className="input" name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option><option value="read">Read</option><option value="unread">Unread</option></select></label>
          <label className="grid gap-1 text-sm">Sort by<select className="input" name="sort" defaultValue={list.sort}>{Object.entries(notificationSorts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="grid gap-1 text-sm">Order<select className="input" name="direction" defaultValue={list.direction}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
          <label className="grid gap-1 text-sm">Rows per page<select className="input" name="size" defaultValue={list.size}>{[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
          <div className="flex items-end gap-2"><button className="btn-primary">Apply</button><a className="btn-secondary" href="?">Reset</a></div>
        </form>

        <DataTable
          empty={error ? "Could not load notifications." : "No notifications match these filters."}
          rows={list.rows}
          sorting={{ header: notificationSorts[list.sort], direction: list.direction, href: header => {
            const key = Object.entries(notificationSorts).find(([, label]) => label === header)?.[0];
            return key ? href({ sort: key, direction: list.sort === key && list.direction === "asc" ? "desc" : "asc", page: "1" }) : null;
          } }}
          columns={[
            { header: "Status", cell: (row) => <StatusPill read={Boolean(row.read_at)} /> },
            { header: "Message", cell: (row) => <span className="font-medium text-ink">{row.message}</span> },
            { header: "Player", cell: (row) => row.player?.display_name ?? "-" },
            { header: "Season", cell: (row) => row.season?.name ?? "-" },
            { header: "Amount", cell: (row) => money(Number(row.amount)) },
            { header: "Created", cell: (row) => formatDateTime(row.created_at) },
            { header: "Action date", cell: (row) => formatDateTime(row.read_at) },
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
        <nav aria-label="Notification pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>{list.total ? (list.page - 1) * list.size + 1 : 0}-{Math.min(list.page * list.size, list.total)} of {list.total} notifications</span>
          <div className="flex items-center gap-3">
            {list.page > 1 ? <a className="btn-secondary" href={href({ page: String(list.page - 1) })} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></a> : <button className="btn-secondary" disabled aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>}
            <span>Page {list.page} of {list.pages}</span>
            {list.page < list.pages ? <a className="btn-secondary" href={href({ page: String(list.page + 1) })} aria-label="Next page"><ChevronRight className="h-4 w-4" /></a> : <button className="btn-secondary" disabled aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>}
          </div>
        </nav>
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
