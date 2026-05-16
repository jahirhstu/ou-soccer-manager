import type { ReactNode } from "react";
import { hasPermission, type Permission } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

export function RoleGuard({ role, permission, children, fallback = null }: { role?: UserRole; permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  return hasPermission(role, permission) ? children : fallback;
}
