"use client";

import type { UserRole } from "@/lib/types";
import { AppNav } from "./AppNav";

export function AdminNav({ role, tenantSlug, programSlug, enabledModules }: { role?: UserRole; tenantSlug?: string | null; programSlug?: string | null; enabledModules?: string[] | null }) {
  return <AppNav role={role} tenantSlug={tenantSlug} programSlug={programSlug} enabledModules={enabledModules} />;
}
