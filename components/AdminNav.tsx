"use client";

import type { UserRole } from "@/lib/types";
import { AppNav } from "./AppNav";

export function AdminNav({ role, tenantSlug }: { role?: UserRole; tenantSlug?: string | null }) {
  return <AppNav role={role} tenantSlug={tenantSlug} />;
}
