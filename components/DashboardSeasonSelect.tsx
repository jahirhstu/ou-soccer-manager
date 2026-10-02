"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function DashboardSeasonSelect({ seasons, selectedId }: {
  seasons: { id: string; name: string; status: string }[];
  selectedId: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  return <label className="grid gap-1 text-sm font-medium text-slate-700">
    Season
    <select className="input min-w-48 max-w-full" value={selectedId} disabled={pending} onChange={(event) => {
      const next = new URLSearchParams(params.toString());
      next.set("season", event.target.value);
      startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
    }}>
      {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.status === "active" ? " (Active)" : ""}</option>)}
    </select>
  </label>;
}
