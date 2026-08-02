"use client";

import type { UserRole } from "@/lib/types";
import { AppNav } from "./AppNav";

export function AdminNav({
  enabledModules,
  unreadNotificationCount,
  role,
  organizationAdmin,
  tenantSlug,
  programSlug
}: {
  enabledModules?: string[] | null;
  unreadNotificationCount?: number;
  role?: UserRole;
  organizationAdmin?: boolean;
  tenantSlug?: string | null;
  programSlug?: string | null;
}) {
  return <AppNav enabledModules={enabledModules} organizationAdmin={organizationAdmin} unreadNotificationCount={unreadNotificationCount} role={role} tenantSlug={tenantSlug} programSlug={programSlug} />;
}
