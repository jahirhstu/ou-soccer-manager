"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Crown, Save, Undo2, UserPlus, Users } from "lucide-react";
import { saveSessionTeamBuilder } from "@/lib/actions/team-builder";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
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
  const router = useRouter();
  const lastLocalSaveAt = useRef(0);
  const tossTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const players = data.players ?? [];
  const existingTeams = data.teams ?? [];
  const serverTeamSignature = useMemo(() => JSON.stringify(existingTeams), [existingTeams]);
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const [playersPerTeam, setPlayersPerTeam] = useState(() => Math.max(1, maxExistingTeamSize(existingTeams) || 8));
  const [teams, setTeams] = useState<DraftTeam[]>(() => initialTeams(existingTeams, 2));
  const [isTossing, setIsTossing] = useState(false);
  const [tossOrderKeys, setTossOrderKeys] = useState<string[] | null>(null);
  const [rouletteRotation, setRouletteRotation] = useState(0);
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
  const pickOrderTeams = orderedTeamsForToss(teams, tossOrderKeys);

  useEffect(() => {
    if (state?.success) {
      lastLocalSaveAt.current = Date.now();
      toast.success(state.message ?? "Teams saved successfully.");
    }
    if (state?.error) toast.error(state.error);
  }, [state]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`session-team-updates-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_team_update_events",
          filter: `session_id=eq.${sessionId}`
        },
        () => {
          router.refresh();
          if (Date.now() - lastLocalSaveAt.current > 3000) {
            toast.success("Teams updated live.");
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, sessionId]);

  useEffect(() => {
    setTeams((current) => initialTeams(existingTeams, current.length || 2));
    setPlayersPerTeam((current) => Math.max(1, maxExistingTeamSize(existingTeams) || current));
    setTossOrderKeys(null);
  }, [existingTeams, serverTeamSignature]);

  useEffect(() => {
    return () => {
      if (tossTimerRef.current) clearInterval(tossTimerRef.current);
    };
  }, []);

  function setTeamCount(count: number) {
    setTossOrderKeys(null);
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

  function startToss() {
    if (isTossing) return;
    setIsTossing(true);
    setTossOrderKeys(null);

    if (tossTimerRef.current) clearInterval(tossTimerRef.current);
    tossTimerRef.current = setInterval(() => {
      setRouletteRotation((current) => current + 23);
      setTossOrderKeys(shuffledKeys(teams));
    }, 60);
  }

  function stopToss() {
    if (!isTossing) return;
    if (tossTimerRef.current) clearInterval(tossTimerRef.current);
    tossTimerRef.current = null;
    const shuffled = orderedTeamsForToss(teams, tossOrderKeys ?? shuffledKeys(teams));
    const extraTurns = 360 * 4;
    const firstIndex = teams.findIndex((team) => team.key === shuffled[0]?.key);
    const segment = 360 / Math.max(teams.length, 1);
    setRouletteRotation((current) => current + extraTurns + Math.max(firstIndex, 0) * segment + segment / 2);
    setTossOrderKeys(shuffled.map((team) => team.key));
    setIsTossing(false);
    const firstPick = shuffled[0]?.name ?? "";
    toast.success(firstPick ? `Toss complete. ${firstPick} picks first.` : "Toss complete. Pick order updated.");
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
    <div className="grid gap-3 sm:gap-5">
      <section className="panel relative overflow-hidden p-3 sm:p-4">
        <div className="pointer-events-none absolute inset-0 opacity-70">
          <div className="absolute -right-10 -top-12 h-28 w-28 rounded-full bg-amber-200/40 blur-2xl" />
          <div className="absolute -bottom-16 left-8 h-28 w-28 rounded-full bg-emerald-200/50 blur-2xl" />
        </div>
        <div className="relative grid gap-4 lg:grid-cols-[minmax(220px,1fr)_260px_minmax(220px,1fr)] lg:items-center">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <label className="grid gap-1 text-xs font-medium text-slate-700 sm:gap-1.5 sm:text-sm">
              Teams
              <select className="input min-h-9" disabled={!canEdit} onChange={(event) => setTeamCount(Number(event.target.value))} value={teams.length}>
                {[2, 3, 4].map((count) => <option key={count} value={count}>{count} teams</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-700 sm:gap-1.5 sm:text-sm">
              Players per team
              <input
                className="input min-h-9"
                disabled={!canEdit}
                min="1"
                onChange={(event) => setPlayersPerTeam(Math.max(1, Number(event.target.value) || 1))}
                type="number"
                value={playersPerTeam}
              />
            </label>
            <div className="col-span-2 grid gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-2 text-xs text-emerald-900 sm:p-3 sm:text-sm">
              <div className="flex flex-wrap gap-1.5">
                <Metric label="Registered" value={players.length} />
                <Metric label="Capacity" value={totalCapacity} />
                <Metric label="Pool" value={poolPlayers.length} />
              </div>
              <p className="text-xs text-emerald-800">Players not assigned to a team remain in the draft pool.</p>
            </div>
          </div>
          <RouletteWheel canEdit={canEdit} displayTeams={pickOrderTeams} isSpinning={isTossing} onToggle={isTossing ? stopToss : startToss} playersById={playersById} rotation={rouletteRotation} segmentTeams={teams} />
          <PickOrderList playersById={playersById} teams={pickOrderTeams} />
        </div>
      </section>

      <section
        className="rounded-lg border border-dashed border-emerald-300 bg-white p-2 shadow-sm sm:p-4"
        onDragOver={(event) => canEdit && event.preventDefault()}
        onDrop={(event) => canEdit && onDrop(event, "pool")}
      >
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2 sm:mb-3 sm:gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-pitch" />
              <h2 className="section-title">Draft pool</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Players not yet assigned to a team stay here for the next pick or as extras.
            </p>
          </div>
          {!canEdit ? (
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              View only
            </span>
          ) : null}
        </div>
        <div className="flex min-h-12 flex-wrap gap-1.5 rounded-md bg-slate-50 p-2 sm:min-h-16 sm:gap-2 sm:p-3">
          {poolPlayers.map((player) => (
            <div className="inline-flex flex-wrap items-center gap-1.5" key={player.id}>
              <PlayerChip
                draggable={canEdit}
                onDragStart={(event) => onDragStart(event, { playerId: player.id, from: "pool" })}
                player={player}
              />
              {canEdit ? (
                <select
                  className="input min-h-8 w-24 px-2 text-xs"
                  onChange={(event) => {
                    if (event.target.value) movePlayer(player.id, event.target.value);
                    event.target.value = "";
                  }}
                  value=""
                >
                  <option value="">Assign</option>
                  {teams.map((team) => (
                    <option disabled={team.playerIds.length >= playersPerTeam} key={team.key} value={team.key}>
                      {team.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ))}
          {!poolPlayers.length ? <p className="text-sm text-slate-500">No players in the draft pool.</p> : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
        {teams.map((team, index) => {
          const isFull = team.playerIds.length >= playersPerTeam;
          const captain = team.captainPlayerId ? playersById.get(team.captainPlayerId) : undefined;
          return (
            <article
              className={cn(
                "grid gap-2 overflow-hidden rounded-lg border bg-white shadow-sm sm:gap-3",
                isFull ? "border-emerald-200" : "border-line"
              )}
              key={team.key}
              onDragOver={(event) => canEdit && !isFull && event.preventDefault()}
              onDrop={(event) => canEdit && !isFull && onDrop(event, team.key)}
            >
              <div className={cn("border-b p-2 sm:p-4", isFull ? "border-emerald-100 bg-emerald-50" : "border-line bg-slate-50")}>
                <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase text-slate-500">
                  <span>Team {index + 1}</span>
                  <span className={cn("rounded px-2 py-0.5", isFull ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-600")}>
                    {team.playerIds.length}/{playersPerTeam}
                  </span>
                </div>
                <input
                  className="mt-1 w-full rounded-md border border-transparent bg-transparent px-0 text-base font-semibold text-ink outline-none transition focus:border-line focus:bg-white focus:px-2 sm:mt-2 sm:text-lg sm:focus:px-3"
                  disabled={!canEdit}
                  onChange={(event) => updateTeam(team.key, { name: event.target.value })}
                  value={team.name}
                />
                {captain ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                    <Crown className="h-3.5 w-3.5" />
                    {captain.name}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">Captain not selected</p>
                )}
              </div>
              <div className="grid gap-2 px-2 sm:gap-3 sm:px-4">
                <label className="grid gap-1 text-[11px] font-semibold uppercase text-slate-500 sm:gap-1.5 sm:text-xs">
                  Captain
                  <select
                    className="input min-h-8 text-xs sm:min-h-10 sm:text-sm"
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
                </label>
              </div>
              <div className="grid min-h-28 content-start gap-1.5 px-2 pb-2 sm:min-h-44 sm:gap-2 sm:px-4 sm:pb-4">
                {team.playerIds.map((playerId) => {
                  const player = playersById.get(playerId);
                  if (!player) return null;
                  return (
                    <div className="grid gap-1" key={player.id}>
                      <PlayerChip
                        draggable={canEdit}
                        onDragStart={(event) => onDragStart(event, { playerId: player.id, from: "team", teamKey: team.key })}
                        player={player}
                      />
                      {canEdit ? (
                        <button className="btn-secondary min-h-7 px-2 text-[11px]" onClick={() => movePlayer(player.id, "pool")} type="button">
                          <Undo2 className="h-3.5 w-3.5" />
                          Draft pool
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {!team.playerIds.length ? (
                  <div className="grid min-h-20 place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-2 text-center text-xs text-slate-500 sm:min-h-28 sm:p-3 sm:text-sm">
                    <div>
                      <UserPlus className="mx-auto mb-2 h-5 w-5 text-slate-400" />
                      Drop players here.
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      {canEdit ? (
        <form action={action} className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white/95 p-2 shadow-sm backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <input name="sessionId" type="hidden" value={sessionId} />
          <input name="teamsJson" type="hidden" value={JSON.stringify(savePayload)} />
          <button className="btn-primary min-h-9" disabled={pending || Boolean(overfilledTeam)}>
            <Save className="h-4 w-4" />
            {pending ? "Saving..." : "Save teams"}
          </button>
          {overfilledTeam ? <p className="text-sm text-rose-700">{overfilledTeam.name} has too many players.</p> : null}
        </form>
      ) : null}
    </div>
  );
}

function RouletteWheel({
  canEdit,
  displayTeams,
  isSpinning,
  onToggle,
  playersById,
  rotation,
  segmentTeams
}: {
  canEdit: boolean;
  displayTeams: DraftTeam[];
  isSpinning: boolean;
  onToggle: () => void;
  playersById: Map<string, TeamBuilderPlayer>;
  rotation: number;
  segmentTeams: DraftTeam[];
}) {
  const orderByKey = new Map(displayTeams.map((team, index) => [team.key, index]));
  const gradient = rouletteGradient(segmentTeams, orderByKey);
  const segment = 360 / Math.max(segmentTeams.length, 1);
  return (
    <div className="relative mx-auto grid h-56 w-56 place-items-center">
      <div
        className={cn("relative h-52 w-52 rounded-full border-4 border-white shadow-lg ring-4 ring-emerald-100 transition-transform duration-700 ease-out", isSpinning && "animate-roulette-spin")}
        style={{ background: gradient, transform: `rotate(${rotation}deg)` }}
      >
        {segmentTeams.map((team, index) => {
          const angle = index * segment + segment / 2;
          const captain = team.captainPlayerId ? playersById.get(team.captainPlayerId) : undefined;
          const orderIndex = orderByKey.get(team.key) ?? index;
          return (
            <span
              className="absolute left-1/2 top-1/2 grid w-24 origin-left -translate-y-1/2 place-items-center text-center text-[10px] font-black uppercase leading-tight text-white drop-shadow"
              key={team.key}
              style={{ transform: `rotate(${angle}deg) translateX(26px) rotate(90deg)` }}
              title={team.name}
            >
              <span className={cn("mb-0.5 grid h-5 w-5 place-items-center rounded-full text-[10px] font-black", orderNumberClass(orderIndex))}>{orderIndex + 1}</span>
              {captain ? <span className="max-w-20 truncate text-[9px] font-semibold normal-case opacity-90">{captain.name}</span> : null}
            </span>
          );
        })}
        <button
          className={cn(
            "absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-white text-xs font-black shadow",
            isSpinning ? "bg-rose-600 text-white" : "bg-emerald-900 text-white"
          )}
          disabled={!canEdit}
          onClick={onToggle}
          type="button"
        >
          {isSpinning ? "STOP" : "PLAY"}
        </button>
      </div>
    </div>
  );
}

function PickOrderList({ playersById, teams }: { playersById: Map<string, TeamBuilderPlayer>; teams: DraftTeam[] }) {
  return (
    <div className="grid gap-2">
      {teams.map((team, index) => {
        const captain = team.captainPlayerId ? playersById.get(team.captainPlayerId) : undefined;
        return (
          <div className="flex items-center gap-2 rounded-md bg-white/75 px-3 py-2 text-left ring-1 ring-line" key={team.key}>
            <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black", orderNumberClass(index))}>
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{captain?.name ?? team.name}</div>
              <div className="truncate text-xs text-slate-500">{team.name}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function rouletteGradient(teams: DraftTeam[], orderByKey: Map<string, number>) {
  const segment = 360 / Math.max(teams.length, 1);
  return `conic-gradient(${teams.map((team, index) => {
    const start = index * segment;
    const end = (index + 1) * segment;
    return `${orderColor(orderByKey.get(team.key) ?? index)} ${start}deg ${end}deg`;
  }).join(", ")})`;
}

function orderColor(index: number) {
  if (index === 0) return "#059669";
  if (index === 1) return "#f59e0b";
  if (index === 2) return "#e11d48";
  return "#64748b";
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
        "inline-flex min-h-8 select-none items-center gap-2 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 sm:min-h-9 sm:px-3 sm:py-1.5 sm:text-sm",
        draggable && "cursor-grab active:cursor-grabbing"
      )}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {player.name}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-100 sm:gap-1.5 sm:px-2.5 sm:text-xs">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      {label}: {value}
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

function orderedTeamsForToss(teams: DraftTeam[], tossOrderKeys: string[] | null) {
  if (!tossOrderKeys?.length) return teams;
  const teamsByKey = new Map(teams.map((team) => [team.key, team]));
  const ordered = tossOrderKeys
    .map((key) => teamsByKey.get(key))
    .filter((team): team is DraftTeam => Boolean(team));
  const orderedKeys = new Set(ordered.map((team) => team.key));
  const missing = teams.filter((team) => !orderedKeys.has(team.key));
  return [...ordered, ...missing];
}

function orderNumberClass(index: number) {
  if (index === 0) return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  if (index === 1) return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
  if (index === 2) return "bg-rose-100 text-rose-800 ring-1 ring-rose-200";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function shuffledKeys(teams: DraftTeam[]) {
  const shuffled = [...teams];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.map((team) => team.key);
}

function maxExistingTeamSize(teams: TeamBuilderTeam[]) {
  return teams.reduce((max, team) => Math.max(max, team.players.length), 0);
}
