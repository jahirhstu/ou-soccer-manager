"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Search, Save, X } from "lucide-react";
import { toast } from "sonner";
import { savePlayerPerformanceRatings } from "@/lib/actions/performance";

export type PerformancePlayerRow = {
  id: string;
  display_name: string;
  preferred_position: string | null;
  attacking_skill_percent: number | null;
  defending_skill_percent: number | null;
  goalkeeping_skill_percent: number | null;
  notes: string | null;
};

type RatingKey = "attacking" | "defending" | "goalkeeping";

type RatingState = Record<RatingKey, number | null>;

export function PerformanceRatingsForm({
  players,
  programId
}: {
  players: PerformancePlayerRow[];
  programId: string;
}) {
  const [query, setQuery] = useState("");
  const [state, action, pending] = useActionState(savePlayerPerformanceRatings, null as { success?: boolean; message?: string; error?: string } | null);
  const [ratings, setRatings] = useState<Record<string, RatingState>>(() => {
    return Object.fromEntries(
      players.map((player) => [
        player.id,
        {
          attacking: player.attacking_skill_percent,
          defending: player.defending_skill_percent,
          goalkeeping: player.goalkeeping_skill_percent
        }
      ])
    );
  });

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return players;
    return players.filter((player) => {
      const name = player.display_name.toLowerCase();
      const position = String(player.preferred_position ?? "").toLowerCase();
      return name.includes(normalizedQuery) || position.includes(normalizedQuery);
    });
  }, [players, query]);

  function setRating(playerId: string, key: RatingKey, value: number | null) {
    setRatings((current) => ({
      ...current,
      [playerId]: {
        ...(current[playerId] ?? { attacking: null, defending: null, goalkeeping: null }),
        [key]: value
      }
    }));
  }

  useEffect(() => {
    if (state?.success) toast.success(state.message ?? "Player ratings saved.");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="grid gap-4">
      <input name="program_id" type="hidden" value={programId} />

      <div className="panel grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input w-full pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter players by name"
            value={query}
          />
        </label>
        <div className="flex min-h-10 items-center rounded-md border border-line bg-slate-50 px-3 text-sm font-semibold text-slate-600">
          {filteredPlayers.length}/{players.length} players
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <div className="hidden grid-cols-[minmax(170px,0.9fr)_minmax(220px,1fr)_minmax(220px,1fr)_minmax(220px,1fr)] gap-3 border-b border-line bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-500 lg:grid">
          <div>Player</div>
          <div>Attacking</div>
          <div>Defending</div>
          <div>Goalkeeping</div>
        </div>
        <div className="divide-y divide-line">
          {filteredPlayers.map((player) => {
            const playerRatings = ratings[player.id] ?? { attacking: null, defending: null, goalkeeping: null };
            return (
              <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(170px,0.9fr)_minmax(220px,1fr)_minmax(220px,1fr)_minmax(220px,1fr)] lg:items-center" key={player.id}>
                <div>
                  <div className="font-semibold text-ink">{player.display_name}</div>
                  <div className="text-xs text-slate-500">{player.preferred_position ?? "No preferred position"}</div>
                </div>
                <RatingSlider
                  label="Attacking"
                  name={`attack_${player.id}`}
                  onChange={(value) => setRating(player.id, "attacking", value)}
                  value={playerRatings.attacking}
                />
                <RatingSlider
                  label="Defending"
                  name={`defense_${player.id}`}
                  onChange={(value) => setRating(player.id, "defending", value)}
                  value={playerRatings.defending}
                />
                <RatingSlider
                  label="Goalkeeping"
                  name={`goalkeeping_${player.id}`}
                  onChange={(value) => setRating(player.id, "goalkeeping", value)}
                  value={playerRatings.goalkeeping}
                />
              </div>
            );
          })}
        </div>
      </div>

      {!filteredPlayers.length ? (
        <div className="panel border-dashed p-10 text-center text-sm text-slate-500">No players match this filter.</div>
      ) : null}

      <button className="btn-primary w-fit" disabled={pending}>
        <Save className="h-4 w-4" />
        {pending ? "Saving..." : "Save ratings"}
      </button>
    </form>
  );
}

function RatingSlider({
  label,
  name,
  onChange,
  value
}: {
  label: string;
  name: string;
  onChange: (value: number | null) => void;
  value: number | null;
}) {
  const displayValue = value == null ? "Not rated" : `${value}%`;
  const rangeValue = value ?? 0;

  return (
    <label className="grid gap-2">
      <input name={name} type="hidden" value={value ?? ""} />
      <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase text-slate-500">
        <span>{label}</span>
        <span className="min-w-16 text-right text-sm font-bold text-ink">{displayValue}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label={label}
          className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-emerald-600"
          max={100}
          min={0}
          onChange={(event) => onChange(Number(event.target.value))}
          step={1}
          type="range"
          value={rangeValue}
        />
        <button
          aria-label={`Clear ${label} rating`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
          onClick={() => onChange(null)}
          title={`Clear ${label}`}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </label>
  );
}
