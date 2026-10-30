export type AppKind = "participant" | "management";
export { importIdentityCandidates } from "./import-identity";
export { balancedDraftRounds } from "./draft-order";
export { buildSessionStandings } from "./standings";
export { sessionSummary } from "./session-summary";
export function accountLoadError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  if (code === "PGRST202" || code === "42883") {
    return "The mobile service is not ready. Ask your administrator to apply the native-app database migration, then retry.";
  }
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" && cause.message.trim()) {
    return cause.message;
  }
  return "Unable to load account. Please check your connection and retry.";
}
export type ProgramRole = "manager" | "captain" | "member";
export type Workspace = {
  organizationId: string;
  organizationName: string;
  programId: string;
  programName: string;
  activityType: string;
  organizationRole?: string;
  role: ProgramRole;
  playerId: string | null;
  currency: string;
  modules: Record<string, boolean>;
};
export type MobileContext = {
  profile: { id: string; displayName: string; email: string; photoPath: string | null };
  workspaces: Workspace[];
  requests?: { name: string; status: string }[];
};
export type Resource = "sessions" | "upcomingSessions" | "mySessions" | "balances" | "myBalances" | "payments" | "myPayments" | "statistics" | "myStatistics" | "seasons" | "players" | "expenses" | "members";
export type ListRow = { id: string; title: string; subtitle: string; detail: string };
export type Page = { rows: ListRow[]; hasMore: boolean };
export function resourceModule(resource: Resource): string {
  if (["sessions", "upcomingSessions", "mySessions", "seasons"].includes(resource)) return "activities";
  if (["players", "members"].includes(resource)) return "members";
  if (["statistics", "myStatistics"].includes(resource)) return "scores";
  if (resource === "expenses") return "expenses";
  return "payments";
}
export function recordStatus(resource: Resource, row: ListRow): string {
  if (["members", "sessions", "upcomingSessions", "mySessions"].includes(resource)) return row.subtitle.split(" / ").at(-1) ?? "";
  if (["players", "seasons"].includes(resource)) return row.subtitle;
  return "";
}
export function filterRecordPage(rows: ListRow[], resource: Resource, query: string, status: string) {
  return rows.filter((row) => (!status || recordStatus(resource, row) === status) &&
    `${row.title} ${row.subtitle} ${row.detail}`.toLowerCase().includes(query.trim().toLowerCase()));
}
export function balanceDescription(detail: string) {
  // mobile_list returns a currency followed by an exact signed decimal amount.
  const match = /^[A-Z]{3} (-?\d+\.\d{2})$/.exec(detail);
  if (!match) return "Balance";
  if (/^-?0\.00$/.test(match[1])) return "Settled";
  return match[1].startsWith("-") ? "Amount owed" : "Available credit";
}
export function canManage(workspace: Workspace | null) { return workspace?.role === "manager"; }
export function canScore(workspace: Workspace | null) {
  return Boolean(workspace && ["manager", "captain"].includes(workspace.role) && workspace.modules.scores !== false);
}
export function canCompleteSession(workspace: Workspace | null, status: string) {
  return Boolean(workspace && workspace.role === "manager" && status === "scheduled"
    && workspace.modules.activities !== false && workspace.modules.attendance !== false);
}
export function accessibleWorkspaces(context: MobileContext, app: AppKind) {
  return context.workspaces.filter((workspace) => app === "participant" || canManage(workspace));
}
// Money stays decimal text from PostgreSQL through forms and RPC calls.
export function validAmount(value: string) { return /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value) && !/^0(?:\.0{1,2})?$/.test(value); }
export function money(value: string, currency: string) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return `${negative ? "-" : ""}${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}
export * from "./performance";
