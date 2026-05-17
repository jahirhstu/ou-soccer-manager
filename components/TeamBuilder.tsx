"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { toast } from "sonner";
import { Save, Users } from "lucide-react";
import { saveSessionTeamBuilder } from "@/lib/actions/team-builder";
import { cn } from "@/lib/utils";

export type TeamBuilderPlayer = {
  id: string;
  name: string;
  status?: string | null;
};

export type TeamBuilderTeam = {
  id?: string;
  name: string;
  captainPlayerId?: string | null;
  players: TeamBuilderPlayer[];
};

export type TeamBuilderData = {
  session?: {
    id: string;
    name?: string | null;
    sessionDate?: string | null;
    location?: string | null;
    status?: string | null;
    seasonName?: string | null;
  } | null;
  players: TeamBuilderPlayer[];
  teams: TeamBuilderTeam[];
};

type DraftTeam = {
  key: string;
  name: string;
  captainPlayerId: string;
  playerIds: string[];
};

type DragSource = {
  playerId: string;
  from: "pool" | "team";
  teamKey?: string;
};

export function TeamBuilder({
  canEdit,
  data,
  sessionId
}: {
  canEdit: boolean;
  data: TeamBuilderData;
  sessionId: string;
}) {
  const players = data.players ?? [];
  const existingTeams = data.teams ?? [];
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const [playersPerTeam, setPlayersPerTeam] = useState(() => Math.max(1, maxExistingTeamSize(existingTeams) || 8));
  const [teams, setTeams] = useState<DraftTeam[]>(() => initialTeams(existingTeams, 2));
  const [state, action, pending] = useActionState(saveSessionTeamBuilder, null as { success?: boolean; message?: string; error?: string } | null);
  const assignedIds = new Set(teams.flatMap((team) => team.playerIds));
  const poolPlayers = players.filter((player) => !assignedIds.has(player.id));
  const savePayload = teams.map((team) => ({
    name: team.name,
    captainPlayerId: team.captainPlayerId || null,
    playerIds: team.playerIds
  }));
  const overfilledTeam = teams.find((team) => team.playerIds.length > playersPerTeam);
  const totalCapacity = teams.length * playersPerTeam;

  useEffect(() => {
    if (state?.success) toast.success(state.message ?? "Teams saved successfully.");
    if (state?.error) toast.error(state.error);
  }, [state]);

  function setTeamCount(count: number) {
    setTeams((current) => {
      if (count === current.length) return current;
      if (count > current.length) {
        return [
          ...current,
          ...Array.from({ length: count - current.length }, (_, index) => ({
            key: `team-${Date.now()}-${index}`,
            name: `Team ${current.length + index + 1}`,
            captainPlayerId: "",
            playerIds: []
          }))
        ];
      }
      const kept = current.slice(0, count);
      const removedPlayerIds = current.slice(count).flatMap((team) => team.playerIds);
      return kept.map((team, index) => index === kept.length - 1 ? { ...team, playerIds: [...team.playerIds, ...removedPlayerIds] } : team);
    });
  }

  function updateTeam(teamKey: string, patch: Partial<DraftTeam>) {
    setTeams((current) => current.map((team) => team.key === teamKey ? { ...team, ...patch } : team));
  }

  function movePlayer(playerId: string, targetTeamKey: string | "pool") {
    setTeams((current) => {
      const removed = current.map((team) => ({ ...team, playerIds: team.playerIds.filter((id) => id !== playerId) }));
      if (targetTeamKey === "pool") return removed;
      return removed.map((team) => {
        if (team.key !== targetTeamKey) return team;
        if (team.playerIds.includes(playerId) || team.playerIds.length >= playersPerTeam) return team;
        return { ...team, playerIds: [...team.playerIds, playerId] };
      });
    });
  }

  function onDragStart(event: DragEvent, source: DragSource) {
    event.dataTransfer.setData("application/json", JSON.stringify(source));
    event.dataTransfer.effectAllowed = "move";
  }

  function onDrop(event: DragEvent, targetTeamKey: string | "pool") {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/json");
    if (!raw) return;
    const source = JSON.parse(raw) as DragSource;
    movePlayer(source.playerId, targetTeamKey);
  }

  return (
    <div className="grid gap-5">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="section-title">Registered players</h2>
            <p className="mt-1 text-sm text-slate-500">
              {players.length} registered. Capacity: {totalCapacity}. Extra players stay in waitlist.
            </p>
          </div>
          {!canEdit ? (
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              View only
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {players.map((player) => (
            <PlayerChip key={player.id} player={player} />
          ))}
        </div>
      </section>

      <section className="panel grid gap-3 p-4 md:grid-cols-[180px_180px_1fr]">
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Teams
          <select className="input" disabled={!canEdit} onChange={(event) => setTeamCount(Number(event.target.value))} value={teams.length}>
            {[2, 3, 4].map((count) => <option key={count} value={count}>{count} teams</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Players per team
          <input
            className="input"
            disabled={!canEdit}
            min="1"
            onChange={(event) => setPlayersPerTeam(Math.max(1, Number(event.target.value) || 1))}
            type="number"
            value={playersPerTeam}
          />
        </label>
        <div className="rounded-md border border-line bg-slate-50 p-3 text-sm text-slate-600">
          Drag players from waitlist into teams. A team stops accepting players when it reaches the selected size.
        </div>
      </section>

      <section
        className="rounded-lg border border-dashed border-slate-300 bg-white p-4"
        onDragOver={(event) => canEdit && event.preventDefault()}
        onDrop={(event) => canEdit && onDrop(event, "pool")}
      >
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-500" />
          <h2 className="section-title">Waitlist / available</h2>
        </div>
        <div className="flex min-h-12 flex-wrap gap-2">
          {poolPlayers.map((player) => (
            <div className="inline-flex flex-wrap items-center gap-1.5" key={player.id}>
              <PlayerChip
                draggable={canEdit}
                onDragStart={(event) => onDragStart(event, { playerId: player.id, from: "pool" })}
                player={player}
              />
              {canEdit ? (
                <select
                  className="input min-h-9 w-28 px-2 text-xs"
                  onChange={(event) => {
                    if (event.target.value) movePlayer(player.id, event.target.value);
                    event.target.value = "";
                  }}
                  value=""
                >
                  <option value="">Move to</option>
                  {teams.map((team) => (
                    <option disabled={team.playerIds.length >= playersPerTeam} key={team.key} value={team.key}>
                      {team.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ))}
          {!poolPlayers.length ? <p className="text-sm text-slate-500">No players waiting.</p> : null}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {teams.map((team, index) => {
          const isFull = team.playerIds.length >= playersPerTeam;
          return (
            <article
              className={cn("panel grid gap-3 p-4", isFull ? "border-emerald-200" : "border-amber-200")}
              key={team.key}
              onDragOver={(event) => canEdit && !isFull && event.preventDefault()}
              onDrop={(event) => canEdit && !isFull && onDrop(event, team.key)}
            >
              <div className="grid gap-2">
                <input
                  className="input font-semibold"
                  disabled={!canEdit}
                  onChange={(event) => updateTeam(team.key, { name: event.target.value })}
                  value={team.name}
                />
                <select
                  className="input"
                  disabled={!canEdit}
                  onChange={(event) => updateTeam(team.key, { captainPlayerId: event.target.value })}
                  value={team.captainPlayerId}
                >
                  <option value="">No captain selected</option>
                  {team.playerIds.map((playerId) => {
                    const player = playersById.get(playerId);
                    return player ? <option key={player.id} value={player.id}>{player.name}</option> : null;
                  })}
                </select>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-500">
                <span>Team {index + 1}</span>
                <span>{team.playerIds.length}/{playersPerTeam}</span>
              </div>
              <div className="grid min-h-40 content-start gap-2 rounded-md bg-slate-50 p-2">
                {team.playerIds.map((playerId) => {
                  const player = playersById.get(playerId);
                  if (!player) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-1.5" key={player.id}>
                      <PlayerChip
                        draggable={canEdit}
                        onDragStart={(event) => onDragStart(event, { playerId: player.id, from: "team", teamKey: team.key })}
                        player={player}
                      />
                      {canEdit ? (
                        <button className="btn-secondary min-h-8 px-2 text-xs" onClick={() => movePlayer(player.id, "pool")} type="button">
                          Waitlist
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {!team.playerIds.length ? <p className="p-2 text-sm text-slate-500">Drop players here.</p> : null}
              </div>
            </article>
          );
        })}
      </section>

      {canEdit ? (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <input name="sessionId" type="hidden" value={sessionId} />
          <input name="teamsJson" type="hidden" value={JSON.stringify(savePayload)} />
          <button className="btn-primary" disabled={pending || Boolean(overfilledTeam)}>
            <Save className="h-4 w-4" />
            {pending ? "Saving..." : "Save teams"}
          </button>
          {overfilledTeam ? <p className="text-sm text-rose-700">{overfilledTeam.name} has too many players.</p> : null}
        </form>
      ) : null}
    </div>
  );
}

function PlayerChip({
  draggable = false,
  onDragStart,
  player
}: {
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  player: TeamBuilderPlayer;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-9 select-none items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm",
        draggable && "cursor-grab active:cursor-grabbing"
      )}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {player.name}
      {player.status ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">{player.status}</span> : null}
    </span>
  );
}

function initialTeams(existingTeams: TeamBuilderTeam[], fallbackCount: number) {
  if (existingTeams.length) {
    return existingTeams.map((team, index) => ({
      key: team.id ?? `existing-team-${index}`,
      name: team.name,
      captainPlayerId: team.captainPlayerId ?? "",
      playerIds: team.players.map((player) => player.id)
    }));
  }

  return Array.from({ length: fallbackCount }, (_, index) => ({
    key: `team-${index + 1}`,
    name: `Team ${index + 1}`,
    captainPlayerId: "",
    playerIds: []
  }));
}

function maxExistingTeamSize(teams: TeamBuilderTeam[]) {
  return teams.reduce((max, team) => Math.max(max, team.players.length), 0);
}
