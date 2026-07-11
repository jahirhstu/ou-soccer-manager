"use client";

import type { UserRole } from "@/lib/types";
import { AppNav } from "./AppNav";

export function AdminNav({
  enabledModules,
  unreadNotificationCount,
  role,
  tenantSlug,
  programSlug
}: {
  enabledModules?: string[] | null;
  unreadNotificationCount?: number;
  role?: UserRole;
  tenantSlug?: string | null;
  programSlug?: string | null;
}) {
  return <AppNav enabledModules={enabledModules} unreadNotificationCount={unreadNotificationCount} role={role} tenantSlug={tenantSlug} programSlug={programSlug} />;
}
