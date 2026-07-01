"use client";

import type { UserRole } from "@/lib/types";
import { AppNav } from "./AppNav";

export function AdminNav({
  unreadNotificationCount,
  role,
  tenantSlug,
  programSlug
}: {
  unreadNotificationCount?: number;
  role?: UserRole;
  tenantSlug?: string | null;
  programSlug?: string | null;
}) {
  return <AppNav unreadNotificationCount={unreadNotificationCount} role={role} tenantSlug={tenantSlug} programSlug={programSlug} />;
}
