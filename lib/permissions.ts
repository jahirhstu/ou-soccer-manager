import type { UserRole } from "./types";

export type Permission = "manage_all" | "manage_attendance" | "manage_stats" | "manage_finance" | "view_reports" | "view_self";

const rolePermissions: Record<UserRole, Permission[]> = {
  admin: ["manage_all", "manage_attendance", "manage_stats", "manage_finance", "view_reports", "view_self"],
  captain: ["manage_attendance", "manage_stats", "view_reports", "view_self"],
  player: ["view_self"]
};

export function hasPermission(role: UserRole | undefined, permission: Permission) {
  if (!role) return false;
  return rolePermissions[role].includes("manage_all") || rolePermissions[role].includes(permission);
}

export function canManageFinance(role: UserRole | undefined) {
  return hasPermission(role, "manage_finance");
}

export function isSessionScoreReadOnly(
  role: UserRole | undefined,
  session: { session_date?: string | null; sessionDate?: string | null; status?: string | null } | null,
  currentDate: string
) {
  if (!session) return false;
  if (session.status === "completed") return true;
  const sessionDate = String(session.session_date ?? session.sessionDate ?? "");
  return sessionDate < currentDate && role !== "admin";
}
