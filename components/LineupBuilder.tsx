"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { saveTeamLineup } from "@/lib/actions/session-management";
import { cn } from "@/lib/utils";

type TeamLineup = {
  sessionTeamId: string;
  playerCount: number;
  formation?: string | null;
  positions: LineupPosition[];
};

type LineupPosition = {
  slot: string;
  label: string;
  x: number;
  y: number;
  playerId?: string;
};

type TeamOption = {
  id: string;
  name: string;
  players: Array<{ id: string; name: string }>;
};

const playerCounts = [5, 6, 7, 8, 9, 10, 11];

export function LineupBuilder({
  lineups,
  sessionId,
  teams
}: {
  lineups: TeamLineup[];
  sessionId: string;
  teams: TeamOption[];
}) {
  const [state, action, pending] = useActionState(saveTeamLineup, null as { success?: boolean; message?: string; error?: string } | null);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const savedLineup = lineups.find((lineup) => lineup.sessionTeamId === selectedTeamId);
  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  const [playerCount, setPlayerCount] = useState(savedLineup?.playerCount ?? Math.min(teams[0]?.players.length || 7, 11));
  const [positions, setPositions] = useState<LineupPosition[]>(() => savedLineup?.positions?.length ? savedLineup.positions : defaultPositions(playerCount));
  const formation = formationName(playerCount);
  const assignedIds = new Set(positions.map((position) => position.playerId).filter(Boolean));
  const availablePlayers = useMemo(
    () => (selectedTeam?.players ?? []).filter((player) => !assignedIds.has(player.id)).sort((left, right) => left.name.localeCompare(right.name)),
    [assignedIds, selectedTeam?.players]
  );

  useEffect(() => {
    if (state?.success) toast.success(state.message ?? "Lineup saved.");
    if (state?.error) toast.error(state.error);
  }, [state]);

  useEffect(() => {
    const nextLineup = lineups.find((lineup) => lineup.sessionTeamId === selectedTeamId);
    const nextCount = nextLineup?.playerCount ?? Math.min(teams.find((team) => team.id === selectedTeamId)?.players.length || 7, 11);
    setPlayerCount(nextCount);
    setPositions(nextLineup?.positions?.length ? nextLineup.positions : defaultPositions(nextCount));
  }, [lineups, selectedTeamId, teams]);

  function changePlayerCount(count: number) {
    setPlayerCount(count);
    const template = defaultPositions(count);
    setPositions((current) =>
      template.map((slot, index) => ({
        ...slot,
        playerId: current[index]?.playerId
      }))
    );
  }

  function assignPlayer(slot: string, playerId: string) {
    setPositions((current) =>
      current.map((position) => ({
        ...position,
        playerId: position.slot === slot ? playerId || undefined : position.playerId === playerId ? undefined : position.playerId
      }))
    );
  }

  return (
    <form action={action} className="grid gap-5">
      <input name="sessionId" type="hidden" value={sessionId} />
      <input name="sessionTeamId" type="hidden" value={selectedTeamId} />
      <input name="playerCount" type="hidden" value={playerCount} />
      <input name="formation" type="hidden" value={formation} />
      <input name="positionsJson" type="hidden" value={JSON.stringify(positions)} />

      <section className="panel grid gap-3 p-4 md:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Team
          <select className="input" onChange={(event) => setSelectedTeamId(event.target.value)} value={selectedTeamId}>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Players
          <select className="input" onChange={(event) => changePlayerCount(Number(event.target.value))} value={playerCount}>
            {playerCounts.map((count) => <option key={count} value={count}>{count} players</option>)}
          </select>
        </label>
        <div className="grid content-end gap-1 text-sm">
          <span className="text-slate-500">Suggested shape</span>
          <span className="text-lg font-semibold text-ink">{formation}</span>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="relative aspect-[7/10] overflow-hidden rounded-lg border border-emerald-700 bg-emerald-700 shadow-sm md:aspect-[16/10]">
          <div className="absolute inset-3 rounded-md border-2 border-white/70" />
          <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/60" />
          <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white/45" />
          <div className="absolute left-1/2 top-1/2 h-0.5 w-full -translate-y-1/2 bg-white/45 md:left-0 md:top-1/2" />
          {positions.map((position) => {
            const player = selectedTeam?.players.find((item) => item.id === position.playerId);
            return (
              <label
                className="absolute grid w-28 -translate-x-1/2 -translate-y-1/2 gap-1 rounded-lg border border-white/40 bg-white/95 p-2 text-center shadow-sm"
                key={position.slot}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
              >
                <span className="text-[10px] font-bold uppercase text-emerald-800">{position.label}</span>
                <select className="min-h-8 rounded-md border border-line bg-white px-1 text-xs" onChange={(event) => assignPlayer(position.slot, event.target.value)} value={position.playerId ?? ""}>
                  <option value="">Open</option>
                  {player ? <option value={player.id}>{player.name}</option> : null}
                  {availablePlayers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        <aside className="panel grid content-start gap-3 p-4">
          <div>
            <h2 className="section-title">Available players</h2>
            <p className="mt-1 text-sm text-slate-500">Assign each player to a field slot. Unassigned players stay here.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {availablePlayers.map((player) => (
              <span className="rounded-md border border-line bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700" key={player.id}>
                {player.name}
              </span>
            ))}
            {!availablePlayers.length ? <p className="text-sm text-slate-500">Every selected-team player is in the lineup.</p> : null}
          </div>
          <button className={cn("btn-primary mt-2 w-fit", !selectedTeamId && "opacity-50")} disabled={pending || !selectedTeamId}>
            <Save className="h-4 w-4" />
            {pending ? "Saving..." : "Save lineup"}
          </button>
        </aside>
      </section>
    </form>
  );
}

function defaultPositions(count: number): LineupPosition[] {
  const layers = positionLayers(count);
  return layers.flatMap((layer, layerIndex) =>
    layer.labels.map((label, index) => ({
      slot: `${layerIndex}-${index}`,
      label,
      x: layer.x,
      y: layerY(index, layer.labels.length),
      playerId: undefined
    }))
  );
}

function positionLayers(count: number) {
  if (count <= 5) return [{ x: 12, labels: ["GK"] }, { x: 36, labels: ["D1", "D2"] }, { x: 64, labels: ["M1"] }, { x: 86, labels: ["F1"] }];
  if (count === 6) return [{ x: 12, labels: ["GK"] }, { x: 34, labels: ["D1", "D2"] }, { x: 58, labels: ["M1", "M2"] }, { x: 84, labels: ["F1"] }];
  if (count === 7) return [{ x: 12, labels: ["GK"] }, { x: 32, labels: ["D1", "D2"] }, { x: 55, labels: ["M1", "M2"] }, { x: 80, labels: ["F1", "F2"] }];
  if (count === 8) return [{ x: 10, labels: ["GK"] }, { x: 30, labels: ["D1", "D2", "D3"] }, { x: 56, labels: ["M1", "M2", "M3"] }, { x: 82, labels: ["F1"] }];
  if (count === 9) return [{ x: 10, labels: ["GK"] }, { x: 28, labels: ["D1", "D2", "D3"] }, { x: 54, labels: ["M1", "M2", "M3"] }, { x: 80, labels: ["F1", "F2"] }];
  if (count === 10) return [{ x: 10, labels: ["GK"] }, { x: 28, labels: ["D1", "D2", "D3"] }, { x: 52, labels: ["M1", "M2", "M3"] }, { x: 76, labels: ["F1", "F2", "F3"] }];
  return [{ x: 10, labels: ["GK"] }, { x: 28, labels: ["D1", "D2", "D3", "D4"] }, { x: 54, labels: ["M1", "M2", "M3"] }, { x: 80, labels: ["F1", "F2", "F3"] }];
}

function formationName(count: number) {
  if (count <= 5) return "2-1-1";
  if (count === 6) return "2-2-1";
  if (count === 7) return "2-2-2";
  if (count === 8) return "3-3-1";
  if (count === 9) return "3-3-2";
  if (count === 10) return "3-3-3";
  return "4-3-3";
}

function layerY(index: number, total: number) {
  if (total === 1) return 50;
  const spacing = Math.min(72 / Math.max(total - 1, 1), 24);
  const start = 50 - (spacing * (total - 1)) / 2;
  return start + index * spacing;
}
