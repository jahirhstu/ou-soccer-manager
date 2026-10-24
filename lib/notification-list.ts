export type NotificationRow = {
  id: string;
  amount: number | string;
  message: string;
  read_at: string | null;
  created_at: string;
  season_id: string;
  player?: { display_name?: string | null } | null;
  season?: { name?: string | null } | null;
};

export const notificationSorts = {
  action: "Action date", created: "Created", player: "Player", season: "Season",
  message: "Message", status: "Status", amount: "Amount"
} as const;

export function notificationList(rows: NotificationRow[], params: Record<string, string | undefined>) {
  const sort = params.sort && Object.prototype.hasOwnProperty.call(notificationSorts, params.sort) ? params.sort as keyof typeof notificationSorts : "action";
  const direction: "asc" | "desc" = params.direction === "asc" ? "asc" : "desc";
  const size = [10, 25, 50, 100].includes(Number(params.size)) ? Number(params.size) : 25;
  const player = params.player?.trim().toLowerCase() ?? "";
  const message = params.message?.trim().toLowerCase() ?? "";
  const filtered = rows.filter(row =>
    (row.player?.display_name ?? "").toLowerCase().includes(player) &&
    row.message.toLowerCase().includes(message) &&
    (!params.season || row.season_id === params.season) &&
    (params.status === "read" ? Boolean(row.read_at) : params.status === "unread" ? !row.read_at : true)
  );
  const value = (row: NotificationRow): string | number => {
    switch (sort) {
      case "action": return Date.parse(row.read_at ?? row.created_at);
      case "created": return Date.parse(row.created_at);
      case "amount": return Number(row.amount);
      case "player": return row.player?.display_name ?? "";
      case "season": return row.season?.name ?? "";
      case "status": return row.read_at ? "Read" : "Unread";
      default: return row.message;
    }
  };
  filtered.sort((a, b) => {
    const left = value(a), right = value(b);
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    return comparison * (direction === "asc" ? 1 : -1) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const requestedPage = Number(params.page);
  const page = Math.min(pages, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  return { rows: filtered.slice((page - 1) * size, page * size), total: filtered.length, page, pages, size, sort, direction };
}
