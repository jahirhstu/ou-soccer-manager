"use client";

import { AppNav } from "./AppNav";

export function PublicNav({ tenantSlug }: { tenantSlug?: string | null }) {
  return <AppNav role="player" tenantSlug={tenantSlug} variant="public" />;
}
