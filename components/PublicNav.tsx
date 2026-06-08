"use client";

import { AppNav } from "./AppNav";

export function PublicNav({ tenantSlug, programSlug }: { tenantSlug?: string | null; programSlug?: string | null }) {
  return <AppNav role="player" tenantSlug={tenantSlug} programSlug={programSlug} variant="public" />;
}
