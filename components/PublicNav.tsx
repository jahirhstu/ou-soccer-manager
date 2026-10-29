"use client";

import { AppNav } from "./AppNav";

export function PublicNav({ tenantSlug, programSlug, enabledModules }: { tenantSlug?: string | null; programSlug?: string | null; enabledModules?: string[] | null }) {
  return <AppNav role="player" tenantSlug={tenantSlug} programSlug={programSlug} enabledModules={enabledModules} variant="public" />;
}
