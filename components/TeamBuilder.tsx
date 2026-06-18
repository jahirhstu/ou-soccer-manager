"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crown, ListOrdered, RadioTower, Save, Shuffle, Undo2, UserPlus, Users } from "lucide-react";
import { autosaveSessionTeamBuilderDraft, saveSessionTeamBuilder } from "@/lib/actions/team-builder";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type TeamBuilderPlayer = {
  id: string;
  name: string;
  status?: string | null;
  attackingSkillPercent?: number | null;
  defendingSkillPercent?: number | null;
  goalkeepingSkillPercent?: number | null;
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
  settings?: {
    playersPerTeam?: number | null;
  } | null;
  players: TeamBuilderPlayer[];
  teams: TeamBuilderTeam[];
  draft?: {
    teams?: DraftSnapshotTeam[];
    playersPerTeam?: number | null;
    draftMode?: "lottery" | "balanced" | null;
    pickCursor?: number | null;
    tossOrderKeys?: string[] | null;
    rouletteRotation?: number | null;
    updatedAt?: string | null;
  } | null;
};

type DraftSnapshotTeam = {
  id?: string;
  key?: string;
  name?: string;
  captainPlayerId?: string | null;
  playerIds?: string[];
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

type DraftMode = "lottery" | "balanced";

type LiveAction = {
  id: string;
  kind: "drag" | "drag_move" | "pick" | "move" | "pool" | "settings" | "toss" | "mode";
  message: string;
  playerId?: string;
  teamKey?: string;
  xPct?: number;
  yPct?: number;
  createdAt: number;
};

type PresenceCounts = {
  editors: number;
  total: number;
  viewers: number;
};

type DraftSaveStatus = "idle" | "saving" | "saved" | "error";

type PointerDragState = DragSource & {
  isDragging: boolean;
  startX: number;
  startY: number;
};

const EMPTY_PLAYERS: TeamBuilderPlayer[] = [];
const EMPTY_TEAMS: TeamBuilderTeam[] = [];

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
  const lastDragBroadcastAt = useRef(0);
  const lastLocalSaveAt = useRef(0);
  const draftAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDraftSignatureRef = useRef("");
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const pressHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tossTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveChannelRef = useRef<any>(null);
  const liveClientId = useRef(`team-builder-${Math.random().toString(36).slice(2)}`);
  const applyingRemoteUpdate = useRef(false);
  const players = data.players ?? EMPTY_PLAYERS;
  const existingTeams = data.teams ?? EMPTY_TEAMS;
  const existingDraft = data.draft ?? null;
  const savedPlayersPerTeam = Number(data.settings?.playersPerTeam ?? 0);
  const serverTeamSignature = useMemo(() => JSON.stringify({ draft: existingDraft, teams: existingTeams }), [existingDraft, existingTeams]);
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const [playersPerTeam, setPlayersPerTeam] = useState(() => Math.max(1, Number(existingDraft?.playersPerTeam ?? 0) || savedPlayersPerTeam || 8));
  const [teams, setTeams] = useState<DraftTeam[]>(() => initialDraftTeams(existingDraft?.teams, existingTeams, 2, players));
  const [draftMode, setDraftMode] = useState<DraftMode>(() => existingDraft?.draftMode === "balanced" ? "balanced" : "lottery");
  const [pickCursor, setPickCursor] = useState(() => Math.max(0, Number(existingDraft?.pickCursor ?? 0) || 0));
  const [isTossing, setIsTossing] = useState(false);
  const [tossOrderKeys, setTossOrderKeys] = useState<string[] | null>(() => Array.isArray(existingDraft?.tossOrderKeys) ? existingDraft.tossOrderKeys : null);
  const [rouletteRotation, setRouletteRotation] = useState(() => Number(existingDraft?.rouletteRotation ?? 0) || 0);
  const [latestAction, setLatestAction] = useState<LiveAction | null>(null);
  const [armedPlayerId, setArmedPlayerId] = useState<string | null>(null);
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);
  const [localDragPreview, setLocalDragPreview] = useState<LiveAction | null>(null);
  const [remoteDragPreview, setRemoteDragPreview] = useState<LiveAction | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>(existingDraft?.updatedAt ? "saved" : "idle");
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(existingDraft?.updatedAt ?? null);
  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts>({ editors: 0, total: 1, viewers: canEdit ? 0 : 1 });
  const [state, action, pending] = useActionState(saveSessionTeamBuilder, null as { success?: boolean; message?: string; error?: string } | null);
  const notifyLiveAction = useCallback((liveAction: LiveAction) => {
    setLatestAction(liveAction);
    if (liveAction.message) toast(liveAction.message);
    if (liveAction.kind === "drag" || liveAction.kind === "drag_move") {
      setRemoteDragPreview(liveAction);
      if (remoteDragTimerRef.current) clearTimeout(remoteDragTimerRef.current);
      remoteDragTimerRef.current = setTimeout(() => {
        setRemoteDragPreview(null);
      }, 2500);
      return;
    }
    if (liveAction.playerId) {
      setRemoteDragPreview((current) => current?.playerId === liveAction.playerId ? null : current);
    }
  }, []);
  const assignedIds = useMemo(() => new Set(teams.flatMap((team) => team.playerIds)), [teams]);
  const poolPlayers = players.filter((player) => !assignedIds.has(player.id));
  const savePayload = teams.map((team) => ({
    id: isUuid(team.key) ? team.key : undefined,
    key: team.key,
    name: team.name,
    captainPlayerId: team.captainPlayerId || null,
    playerIds: team.playerIds
  }));
  const overfilledTeam = teams.find((team) => team.playerIds.length > playersPerTeam);
  const totalCapacity = teams.length * playersPerTeam;
  const pickOrderTeams = useMemo(() => orderedTeamsForToss(teams, tossOrderKeys), [teams, tossOrderKeys]);
  const balancedDraftStarted = draftMode === "balanced" && Boolean(tossOrderKeys?.length);
  const effectivePickCursor = draftMode === "balanced" && !balancedDraftStarted ? 0 : pickCursor;
  const remainingDraftPicks = teams.reduce((total, team) => total + Math.max(playersPerTeam - team.playerIds.length, 0), 0);
  const trackedDraftPicks = draftMode === "balanced" ? effectivePickCursor + remainingDraftPicks : players.length;
  const totalDraftRounds = Math.max(Math.ceil(trackedDraftPicks / Math.max(teams.length, 1)), 1);
  const balancedRounds = useMemo(
    () => buildBalancedDraftRounds(pickOrderTeams, totalDraftRounds),
    [pickOrderTeams, totalDraftRounds]
  );
  const scheduledPickCounts = useMemo(() => pickPositionCounts(balancedRounds), [balancedRounds]);
  const activeTurn = draftMode === "balanced" && balancedDraftStarted ? getDraftTurn(balancedRounds, effectivePickCursor) : null;
  const nextTurn = draftMode === "balanced" && balancedDraftStarted ? getDraftTurn(balancedRounds, effectivePickCursor + 1) : null;
  const hasAllCaptainsSelected = teams.length > 0 && teams.every((team) => Boolean(team.captainPlayerId));
  const hasCaptainPick = teams.some((team) => team.playerIds.some((playerId) => playerId !== team.captainPlayerId));
  const [teamBuildingStarted, setTeamBuildingStarted] = useState(() => {
    const initialTeams = initialDraftTeams(existingDraft?.teams, existingTeams, 2, players);
    return initialTeams.length > 0 &&
      initialTeams.every((team) => Boolean(team.captainPlayerId)) &&
      initialTeams.some((team) => team.playerIds.some((playerId) => playerId !== team.captainPlayerId));
  });
  const canUseRoulette = canEdit && !(draftMode === "balanced" && balancedDraftStarted && effectivePickCursor > 0);

  useEffect(() => {
    if (state?.success) {
      lastLocalSaveAt.current = Date.now();
      if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current);
      draftAutosaveTimerRef.current = null;
      setDraftSaveStatus("idle");
      setDraftUpdatedAt(null);
      toast.success(state.message ?? "Teams saved successfully.");
    }
    if (state?.error) toast.error(state.error);
  }, [state]);

  function scheduleDraftAutosave(snapshot: Partial<{
    teams: DraftTeam[];
    playersPerTeam: number;
    draftMode: DraftMode;
    pickCursor: number;
    tossOrderKeys: string[] | null;
    rouletteRotation: number;
  }>) {
    if (!canEdit || applyingRemoteUpdate.current) return;
    const nextSnapshot = {
      draftMode: snapshot.draftMode ?? draftMode,
      pickCursor: Math.max(0, Number(snapshot.pickCursor ?? pickCursor) || 0),
      playersPerTeam: Math.max(1, Number(snapshot.playersPerTeam ?? playersPerTeam) || 8),
      rouletteRotation: Number(snapshot.rouletteRotation ?? rouletteRotation) || 0,
      teams: serializeDraftTeams(snapshot.teams ?? teams),
      tossOrderKeys: Array.isArray(snapshot.tossOrderKeys) ? snapshot.tossOrderKeys : snapshot.tossOrderKeys === null ? null : tossOrderKeys
    };
    const signature = JSON.stringify(nextSnapshot);
    if (signature === lastDraftSignatureRef.current) return;
    lastDraftSignatureRef.current = signature;
    setDraftSaveStatus("saving");
    if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current);
    draftAutosaveTimerRef.current = setTimeout(() => {
      void autosaveSessionTeamBuilderDraft({
        sessionId,
        ...nextSnapshot
      }).then((result) => {
        if (result?.success) {
          setDraftSaveStatus("saved");
          setDraftUpdatedAt(result.updatedAt ?? new Date().toISOString());
          return;
        }
        setDraftSaveStatus("error");
        if (result?.error) toast.error(result.error);
      });
    }, 650);
  }

  function broadcastLive(snapshot: Partial<{
    teams: DraftTeam[];
    playersPerTeam: number;
    draftMode: DraftMode;
    pickCursor: number;
    isTossing: boolean;
    tossOrderKeys: string[] | null;
    rouletteRotation: number;
    action: LiveAction | null;
  }>) {
    if (!canEdit || applyingRemoteUpdate.current) return;
    if (
      "teams" in snapshot ||
      "playersPerTeam" in snapshot ||
      "draftMode" in snapshot ||
      "pickCursor" in snapshot ||
      "tossOrderKeys" in snapshot ||
      "rouletteRotation" in snapshot
    ) {
      scheduleDraftAutosave(snapshot);
    }
    if (!liveChannelRef.current) return;
    void liveChannelRef.current.send({
      type: "broadcast",
      event: "team_builder_state",
      payload: {
        senderId: liveClientId.current,
        teams,
        playersPerTeam,
        draftMode,
        pickCursor,
        isTossing,
        tossOrderKeys,
        rouletteRotation,
        ...snapshot
      }
    });
  }

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`session-team-updates-${sessionId}`, {
        config: { presence: { key: liveClientId.current } }
      })
      .on("broadcast", { event: "team_builder_state" }, ({ payload }) => {
        if (!payload || payload.senderId === liveClientId.current) return;
        applyingRemoteUpdate.current = true;
        if (Array.isArray(payload.teams)) setTeams(payload.teams);
        if (Number(payload.playersPerTeam) > 0) setPlayersPerTeam(Number(payload.playersPerTeam));
        if (payload.draftMode === "lottery" || payload.draftMode === "balanced") setDraftMode(payload.draftMode);
        if (Number.isFinite(Number(payload.pickCursor))) setPickCursor(Math.max(0, Number(payload.pickCursor)));
        if (typeof payload.isTossing === "boolean") setIsTossing(payload.isTossing);
        if (Array.isArray(payload.tossOrderKeys) || payload.tossOrderKeys === null) setTossOrderKeys(payload.tossOrderKeys);
        if (Number.isFinite(Number(payload.rouletteRotation))) setRouletteRotation(Number(payload.rouletteRotation));
        if (payload.action) notifyLiveAction(payload.action);
        window.setTimeout(() => {
          applyingRemoteUpdate.current = false;
        }, 0);
      })
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
      .on("presence", { event: "sync" }, () => {
        setPresenceCounts(countPresence(channel.presenceState()));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({
            clientId: liveClientId.current,
            role: canEdit ? "editor" : "viewer",
            onlineAt: new Date().toISOString()
          });
        }
      });
    liveChannelRef.current = channel;

    return () => {
      liveChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [canEdit, notifyLiveAction, router, sessionId]);

  useEffect(() => {
    const nextTeams = initialDraftTeams(existingDraft?.teams, existingTeams, 2, players);
    const nextPlayersPerTeam = Math.max(1, Number(existingDraft?.playersPerTeam ?? 0) || savedPlayersPerTeam || 8);
    const nextDraftMode = existingDraft?.draftMode === "balanced" ? "balanced" : "lottery";
    const nextPickCursor = Math.max(0, Number(existingDraft?.pickCursor ?? 0) || 0);
    const nextTossOrderKeys = Array.isArray(existingDraft?.tossOrderKeys) ? existingDraft.tossOrderKeys : null;
    const nextRouletteRotation = Number(existingDraft?.rouletteRotation ?? 0) || 0;
    setTeams(nextTeams);
    setPlayersPerTeam(nextPlayersPerTeam);
    setDraftMode(nextDraftMode);
    setPickCursor(nextPickCursor);
    setTossOrderKeys(nextTossOrderKeys);
    setRouletteRotation(nextRouletteRotation);
    setDraftUpdatedAt(existingDraft?.updatedAt ?? null);
    setDraftSaveStatus(existingDraft?.updatedAt ? "saved" : "idle");
    lastDraftSignatureRef.current = JSON.stringify({
      draftMode: nextDraftMode,
      pickCursor: nextPickCursor,
      playersPerTeam: nextPlayersPerTeam,
      rouletteRotation: nextRouletteRotation,
      teams: serializeDraftTeams(nextTeams),
      tossOrderKeys: nextTossOrderKeys
    });
  }, [existingDraft, existingTeams, players, savedPlayersPerTeam, serverTeamSignature]);

  useEffect(() => {
    return () => {
      if (draftAutosaveTimerRef.current) clearTimeout(draftAutosaveTimerRef.current);
      if (pressHoldTimerRef.current) clearTimeout(pressHoldTimerRef.current);
      if (remoteDragTimerRef.current) clearTimeout(remoteDragTimerRef.current);
      if (tossTimerRef.current) clearInterval(tossTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (hasAllCaptainsSelected && hasCaptainPick) setTeamBuildingStarted(true);
  }, [hasAllCaptainsSelected, hasCaptainPick]);

  function clearPressState() {
    if (pressHoldTimerRef.current) clearTimeout(pressHoldTimerRef.current);
    pressHoldTimerRef.current = null;
    setArmedPlayerId(null);
  }

  function clearPointerDragState() {
    pointerDragRef.current = null;
    clearPressState();
    setDraggingPlayerId(null);
    setLocalDragPreview(null);
  }

  function setTeamCount(count: number) {
    setTossOrderKeys(null);
    setTeams((current) => {
      if (count === current.length) return current;
      let actionMessage: string;
      let nextTeams: DraftTeam[];
      if (count > current.length) {
        nextTeams = [
          ...current,
          ...Array.from({ length: count - current.length }, (_, index) => ({
            key: `team-${Date.now()}-${index}`,
            name: `Team ${current.length + index + 1}`,
            captainPlayerId: "",
            playerIds: []
          }))
        ];
        actionMessage = `Team count changed to ${count}.`;
        const action = createLiveAction("settings", actionMessage);
        notifyLiveAction(action);
        broadcastLive({ teams: nextTeams, tossOrderKeys: null, action });
        return nextTeams;
      }
      const kept = current.slice(0, count);
      const removedPlayerIds = current.slice(count).flatMap((team) => team.playerIds);
      nextTeams = kept.map((team, index) => index === kept.length - 1 ? { ...team, playerIds: [...team.playerIds, ...removedPlayerIds] } : team);
      actionMessage = `Team count changed to ${count}.`;
      const action = createLiveAction("settings", actionMessage);
      notifyLiveAction(action);
      broadcastLive({ teams: nextTeams, tossOrderKeys: null, action });
      return nextTeams;
    });
  }

  function updateTeam(teamKey: string, patch: Partial<DraftTeam>) {
    setTeams((current) => {
      const previous = current.find((team) => team.key === teamKey);
      const nextTeams = current.map((team) => team.key === teamKey ? { ...team, ...patch } : team);
      let action: LiveAction | null = null;
      if (patch.captainPlayerId !== undefined && previous?.captainPlayerId !== patch.captainPlayerId) {
        const captain = patch.captainPlayerId ? playersById.get(patch.captainPlayerId) : undefined;
        action = createLiveAction("settings", `${nextTeams.find((team) => team.key === teamKey)?.name ?? "Team"} captain changed${captain ? ` to ${captain.name}` : ""}.`, { teamKey });
      }
      if (action) notifyLiveAction(action);
      broadcastLive({ teams: nextTeams, action });
      return nextTeams;
    });
  }

  function movePlayer(playerId: string, targetTeamKey: string | "pool") {
    setTeams((current) => {
      const player = playersById.get(playerId);
      const sourceTeam = current.find((team) => team.playerIds.includes(playerId));
      const source = sourceTeam ? "team" : "pool";
      const removed = current.map((team) => ({ ...team, playerIds: team.playerIds.filter((id) => id !== playerId) }));
      const basePickCursor = draftMode === "balanced" && !balancedDraftStarted ? 0 : pickCursor;
      if (targetTeamKey === "pool") {
        const isCaptainReturn = sourceTeam?.captainPlayerId === playerId;
        const shouldRewindPick = sourceTeam && (draftMode !== "balanced" || (balancedDraftStarted && !isCaptainReturn));
        const nextPickCursor = shouldRewindPick ? Math.max(0, basePickCursor - 1) : basePickCursor;
        const action = createLiveAction("pool", `${player?.name ?? "Player"} moved to Draft pool${sourceTeam ? ` from ${sourceTeam.name}` : ""}.`, {
          playerId,
          teamKey: sourceTeam?.key
        });
        setPickCursor(nextPickCursor);
        setDraggingPlayerId(null);
        setLocalDragPreview(null);
        setRemoteDragPreview(null);
        notifyLiveAction(action);
        broadcastLive({ teams: removed, pickCursor: nextPickCursor, action });
        return removed;
      }
      const targetTeam = current.find((team) => team.key === targetTeamKey);
      let didAssign = false;
      const nextTeams = removed.map((team) => {
        if (team.key !== targetTeamKey) return team;
        if (team.playerIds.includes(playerId) || team.playerIds.length >= playersPerTeam) return team;
        didAssign = true;
        return { ...team, playerIds: [...team.playerIds, playerId] };
      });
      if (!didAssign) return current;
      const isDraftPick = source === "pool" && (draftMode !== "balanced" || balancedDraftStarted);
      const nextPickCursor = isDraftPick ? basePickCursor + 1 : basePickCursor;
      const action = createLiveAction(isDraftPick ? "pick" : "move", `${targetTeam?.name ?? "Team"} ${isDraftPick ? "picked" : "received"} ${player?.name ?? "player"}${sourceTeam ? ` from ${sourceTeam.name}` : ""}.`, {
        playerId,
        teamKey: targetTeamKey
      });
      setPickCursor(nextPickCursor);
      setDraggingPlayerId(null);
      setLocalDragPreview(null);
      setRemoteDragPreview(null);
      notifyLiveAction(action);
      broadcastLive({ teams: nextTeams, pickCursor: nextPickCursor, action });
      return nextTeams;
    });
  }

  function changeDraftMode(nextMode: DraftMode) {
    if (nextMode === draftMode) return;
    if (teamBuildingStarted) return;
    setDraftMode(nextMode);
    const action = createLiveAction("mode", `Draft mode switched to ${nextMode === "balanced" ? "Balanced rotating order" : "Lottery"}.`);
    notifyLiveAction(action);
    broadcastLive({ draftMode: nextMode, action });
  }

  function startToss() {
    if (isTossing) return;
    setIsTossing(true);
    setTossOrderKeys(null);
    const action = createLiveAction("toss", "Roulette started.");
    notifyLiveAction(action);
    broadcastLive({ isTossing: true, tossOrderKeys: null, action });

    if (tossTimerRef.current) clearInterval(tossTimerRef.current);
    tossTimerRef.current = setInterval(() => {
      const nextOrder = shuffledKeys(teams);
      setRouletteRotation((current) => {
        const nextRotation = current + 23;
        broadcastLive({ isTossing: true, rouletteRotation: nextRotation, tossOrderKeys: nextOrder });
        return nextRotation;
      });
      setTossOrderKeys(nextOrder);
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
    if (draftMode === "balanced") setPickCursor(0);
    const nextAction = createLiveAction("toss", shuffled[0]?.name ? `Roulette complete. ${shuffled[0].name} picks first.` : "Roulette complete.", {
      teamKey: shuffled[0]?.key
    });
    notifyLiveAction(nextAction);
    broadcastLive({
      isTossing: false,
      rouletteRotation: rouletteRotation + extraTurns + Math.max(firstIndex, 0) * segment + segment / 2,
      tossOrderKeys: shuffled.map((team) => team.key),
      pickCursor: draftMode === "balanced" ? 0 : pickCursor,
      action: nextAction
    });
  }

  function onDragStart(event: DragEvent, source: DragSource) {
    clearPressState();
    setDraggingPlayerId(source.playerId);
    event.dataTransfer.setData("application/json", JSON.stringify(source));
    event.dataTransfer.setData("text/plain", source.playerId);
    event.dataTransfer.effectAllowed = "move";
    const player = playersById.get(source.playerId);
    const action = createLiveAction("drag", `Picking ${player?.name ?? "player"}...`, {
      playerId: source.playerId,
      teamKey: source.teamKey,
      ...dragPosition(event)
    });
    setLatestAction(action);
    broadcastLive({ action });
  }

  function broadcastPointerDrag(source: DragSource, event: PointerEvent, kind: "drag" | "drag_move") {
    const player = playersById.get(source.playerId);
    const action = createLiveAction(kind, kind === "drag" ? `Picking ${player?.name ?? "player"}...` : "", {
      playerId: source.playerId,
      teamKey: source.teamKey,
      ...pointerPosition(event)
    });
    setLocalDragPreview(action);
    if (kind === "drag") setLatestAction(action);
    broadcastLive({ action });
  }

  function onDrag(event: DragEvent, playerId: string, teamKey?: string) {
    if (!event.clientX && !event.clientY) return;
    const now = Date.now();
    if (now - lastDragBroadcastAt.current < 90) return;
    lastDragBroadcastAt.current = now;
    broadcastLive({
      action: createLiveAction("drag_move", "", {
        playerId,
        teamKey,
        ...dragPosition(event)
      })
    });
  }

  function onDragEnd(playerId?: string) {
    clearPressState();
    setDraggingPlayerId(null);
    if (playerId && latestAction?.kind === "drag" && latestAction.playerId === playerId) {
      window.setTimeout(() => {
        setLatestAction((current) => current?.kind === "drag" && current.playerId === playerId ? null : current);
      }, 700);
    }
  }

  function onDrop(event: DragEvent, targetTeamKey: string | "pool") {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/json");
    const source = raw ? JSON.parse(raw) as DragSource : { playerId: event.dataTransfer.getData("text/plain"), from: "pool" as const };
    if (!source.playerId) return;
    movePlayer(source.playerId, targetTeamKey);
  }

  function onPlayerPointerDown(event: PointerEvent, source: DragSource) {
    if (!canEdit) return;
    if (event.pointerType !== "mouse") {
      pointerDragRef.current = {
        ...source,
        isDragging: false,
        startX: event.clientX,
        startY: event.clientY
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (pressHoldTimerRef.current) clearTimeout(pressHoldTimerRef.current);
    pressHoldTimerRef.current = setTimeout(() => {
      setArmedPlayerId(source.playerId);
    }, 180);
  }

  function onPlayerPointerMove(event: PointerEvent) {
    const source = pointerDragRef.current;
    if (!source) return;
    const distance = Math.hypot(event.clientX - source.startX, event.clientY - source.startY);
    if (!source.isDragging && distance < 8 && armedPlayerId !== source.playerId) return;
    event.preventDefault();
    if (!source.isDragging) {
      pointerDragRef.current = { ...source, isDragging: true };
      setDraggingPlayerId(source.playerId);
      clearPressState();
      broadcastPointerDrag(source, event, "drag");
      return;
    }
    const now = Date.now();
    if (now - lastDragBroadcastAt.current < 90) return;
    lastDragBroadcastAt.current = now;
    broadcastPointerDrag(source, event, "drag_move");
  }

  function onPlayerPointerUp(event: PointerEvent) {
    const source = pointerDragRef.current;
    if (!source) {
      clearPressState();
      return;
    }
    if (source.isDragging) {
      event.preventDefault();
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const teamDrop = target?.closest<HTMLElement>("[data-team-drop-key]");
      const poolDrop = target?.closest<HTMLElement>("[data-pool-drop]");
      if (teamDrop?.dataset.teamDropKey) {
        movePlayer(source.playerId, teamDrop.dataset.teamDropKey);
      } else if (poolDrop) {
        movePlayer(source.playerId, "pool");
      }
    }
    clearPointerDragState();
  }

  return (
    <div className="grid gap-3 sm:gap-5">
      <section className="panel relative overflow-hidden p-3 sm:p-4">
        <div className="relative grid gap-4 lg:grid-cols-[minmax(220px,1fr)_260px_minmax(220px,1fr)] lg:items-center">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="col-span-2 grid grid-cols-2 rounded-md border border-line bg-slate-50 p-1">
              {(["lottery", "balanced"] as const).map((mode) => (
                <button
                  className={cn(
                    "inline-flex min-h-9 items-center justify-center gap-2 rounded px-2 text-xs font-semibold transition sm:text-sm",
                    draftMode === mode ? "bg-white text-pitch shadow-sm ring-1 ring-line" : "text-slate-600 hover:text-ink",
                    teamBuildingStarted && "cursor-not-allowed opacity-60 hover:text-slate-600"
                  )}
                  disabled={!canEdit || teamBuildingStarted}
                  key={mode}
                  onClick={() => changeDraftMode(mode)}
                  title={teamBuildingStarted ? "Draft mode is locked after team building starts." : undefined}
                  type="button"
                >
                  {mode === "lottery" ? <Shuffle className="h-4 w-4" /> : <ListOrdered className="h-4 w-4" />}
                  {mode === "lottery" ? "Lottery" : "Balanced"}
                </button>
              ))}
            </div>
            <label className="grid min-w-0 gap-1 rounded-md border border-line bg-white p-1.5 text-[11px] font-semibold uppercase text-slate-500 sm:gap-1.5 sm:p-2 sm:text-xs">
              Teams
              <select className="h-8 w-full rounded border border-line bg-slate-50 px-2 text-xs font-semibold text-ink outline-none focus:border-pitch focus:ring-2 focus:ring-emerald-100 sm:h-9 sm:text-sm" disabled={!canEdit} onChange={(event) => setTeamCount(Number(event.target.value))} value={teams.length}>
                {[2, 3, 4].map((count) => <option key={count} value={count}>{count} teams</option>)}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 rounded-md border border-line bg-white p-1.5 text-[11px] font-semibold uppercase text-slate-500 sm:gap-1.5 sm:p-2 sm:text-xs">
              Players/team
              <input
                className="h-8 w-full rounded border border-line bg-slate-50 px-2 text-center text-xs font-semibold text-ink outline-none focus:border-pitch focus:ring-2 focus:ring-emerald-100 sm:h-9 sm:text-sm"
                disabled={!canEdit}
                min="1"
                onChange={(event) => {
                  const nextPlayersPerTeam = Math.max(1, Number(event.target.value) || 1);
                  const action = createLiveAction("settings", `Players per team changed to ${nextPlayersPerTeam}.`);
                  setPlayersPerTeam(nextPlayersPerTeam);
                  notifyLiveAction(action);
                  broadcastLive({ playersPerTeam: nextPlayersPerTeam, action });
                }}
                type="number"
                value={playersPerTeam}
              />
            </label>
            <div className="col-span-2 grid gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-2 text-xs text-emerald-900 sm:p-3 sm:text-sm">
              <div className="flex flex-wrap gap-1.5">
                <Metric label="Registered" value={players.length} />
                <Metric label="Capacity" value={totalCapacity} />
                <Metric label="Pool" value={poolPlayers.length} />
                <PresenceMetric counts={presenceCounts} />
              </div>
              <p className="text-xs text-emerald-800">Players not assigned to a team remain in the draft pool.</p>
            </div>
          </div>
          <RouletteWheel canEdit={canUseRoulette} displayTeams={pickOrderTeams} isSpinning={isTossing} onToggle={isTossing ? stopToss : startToss} rotation={rouletteRotation} segmentTeams={teams} />
          <div className="grid gap-3">
            <TurnPanel activeTurn={activeTurn} draftMode={draftMode} draftStarted={balancedDraftStarted} nextTurn={nextTurn} pickCursor={effectivePickCursor} playersById={playersById} positionCounts={scheduledPickCounts} teams={pickOrderTeams} totalPicks={trackedDraftPicks} />
            <PickOrderList activeTeamKey={activeTurn?.team.key} playersById={playersById} teams={pickOrderTeams} />
          </div>
        </div>
      </section>

      {draftMode === "balanced" ? (
        <BalancedDraftBoard activePickIndex={effectivePickCursor} draftStarted={balancedDraftStarted} playersById={playersById} rounds={balancedRounds} />
      ) : null}

      {remoteDragPreview?.playerId ? (
        <FloatingDragPreview action={remoteDragPreview} playersById={playersById} />
      ) : null}

      {localDragPreview?.playerId ? (
        <FloatingDragPreview action={localDragPreview} playersById={playersById} />
      ) : null}

      <section
        className="rounded-lg border border-dashed border-emerald-300 bg-white p-2 shadow-sm sm:p-4"
        data-pool-drop="true"
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
              {canEdit ? (
                <PoolPlayerSelect
                  activeTeamKey={balancedDraftStarted ? activeTurn?.team.key : undefined}
                  highlighted={latestAction?.playerId === player.id || remoteDragPreview?.playerId === player.id}
                  onAssign={(teamKey) => movePlayer(player.id, teamKey)}
                  player={player}
                  playersById={playersById}
                  teams={draftMode === "balanced" ? pickOrderTeams : teams}
                  playersPerTeam={playersPerTeam}
                  restrictToActiveTurn={draftMode === "balanced" && balancedDraftStarted}
                />
              ) : (
                <PlayerChip highlighted={latestAction?.playerId === player.id} player={player} previewed={remoteDragPreview?.playerId === player.id} />
              )}
            </div>
          ))}
          {!poolPlayers.length ? <p className="text-sm text-slate-500">No players in the draft pool.</p> : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
        {teams.map((team, index) => {
          const isFull = team.playerIds.length >= playersPerTeam;
          const captain = team.captainPlayerId ? playersById.get(team.captainPlayerId) : undefined;
          const isDropReady = canEdit && Boolean(draggingPlayerId) && !isFull;
          return (
            <article
              className={cn(
                "grid gap-2 overflow-hidden rounded-lg border bg-white shadow-sm sm:gap-3",
                isDropReady ? "border-emerald-300 ring-2 ring-emerald-100" : latestAction?.teamKey === team.key ? "border-amber-300 ring-2 ring-amber-100" : isFull ? "border-emerald-200" : "border-line"
              )}
              data-team-drop-key={team.key}
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
                    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-white p-1.5 shadow-sm" key={player.id}>
                      <PlayerChip
                        armed={armedPlayerId === player.id}
                        draggable={canEdit}
                        dragging={draggingPlayerId === player.id}
                        grow
                        highlighted={latestAction?.playerId === player.id}
                        onDrag={(event) => onDrag(event, player.id, team.key)}
                        onDragEnd={() => onDragEnd(player.id)}
                        onDragStart={(event) => onDragStart(event, { playerId: player.id, from: "team", teamKey: team.key })}
                        onPointerCancel={clearPointerDragState}
                        onPointerDown={(event) => onPlayerPointerDown(event, { playerId: player.id, from: "team", teamKey: team.key })}
                        onPointerMove={onPlayerPointerMove}
                        onPointerUp={onPlayerPointerUp}
                        player={player}
                        previewed={remoteDragPreview?.playerId === player.id}
                      />
                      {canEdit ? (
                        <button
                          aria-label={`Return ${player.name} to draft pool`}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-pitch"
                          onClick={() => movePlayer(player.id, "pool")}
                          title="Return to draft pool"
                          type="button"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
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
          <input name="playersPerTeam" type="hidden" value={playersPerTeam} />
          <input name="teamsJson" type="hidden" value={JSON.stringify(savePayload)} />
          <button className="btn-primary min-h-9" disabled={pending || Boolean(overfilledTeam)}>
            <Save className="h-4 w-4" />
            {pending ? "Saving..." : "Save teams"}
          </button>
          {overfilledTeam ? <p className="text-sm text-rose-700">{overfilledTeam.name} has too many players.</p> : null}
          <DraftAutosaveStatus status={draftSaveStatus} updatedAt={draftUpdatedAt} />
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
  rotation,
  segmentTeams
}: {
  canEdit: boolean;
  displayTeams: DraftTeam[];
  isSpinning: boolean;
  onToggle: () => void;
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
          const angle = index * segment;
          return <span className="absolute left-1/2 top-1/2 h-0.5 w-24 origin-left bg-white/50" key={team.key} style={{ transform: `rotate(${angle}deg)` }} />;
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

function PickOrderList({ activeTeamKey, playersById, teams }: { activeTeamKey?: string; playersById: Map<string, TeamBuilderPlayer>; teams: DraftTeam[] }) {
  return (
    <div className="grid gap-2">
      {teams.map((team, index) => {
        const captain = team.captainPlayerId ? playersById.get(team.captainPlayerId) : undefined;
        return (
          <div className={cn("flex items-center gap-2 rounded-md bg-white/75 px-3 py-2 text-left ring-1 ring-line", activeTeamKey === team.key && "bg-emerald-50 ring-emerald-200")} key={team.key}>
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

function TurnPanel({
  activeTurn,
  draftMode,
  draftStarted,
  nextTurn,
  pickCursor,
  playersById,
  positionCounts,
  teams,
  totalPicks
}: {
  activeTurn: DraftTurn | null;
  draftMode: DraftMode;
  draftStarted: boolean;
  nextTurn: DraftTurn | null;
  pickCursor: number;
  playersById: Map<string, TeamBuilderPlayer>;
  positionCounts: Map<string, number[]>;
  teams: DraftTeam[];
  totalPicks: number;
}) {
  if (draftMode === "lottery") {
    return (
      <div className="rounded-md border border-line bg-white p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          <RadioTower className="h-4 w-4 text-pitch" />
          Live order
        </div>
        <p className="mt-2 text-sm font-semibold text-ink">Lottery mode</p>
        <p className="mt-1 text-xs text-slate-500">Spin any time to refresh the pick order.</p>
      </div>
    );
  }

  if (!draftStarted) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-amber-800">
          <RadioTower className="h-4 w-4" />
          Suggested turn
        </div>
        <p className="mt-2 text-base font-semibold text-ink">Set captains, then run roulette</p>
        <p className="mt-1 text-xs text-amber-900">Captain setup will not count as draft turns.</p>
      </div>
    );
  }

  const activeName = activeTurn ? turnDisplayName(activeTurn.team, playersById) : "";
  const nextName = nextTurn ? turnDisplayName(nextTurn.team, playersById) : "";

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-emerald-800">
        <RadioTower className="h-4 w-4" />
        Suggested turn
      </div>
      <p className="mt-2 text-base font-semibold text-ink">
        {activeTurn ? `${activeName} picks now` : "Draft order complete"}
      </p>
      <p className="mt-1 text-xs text-emerald-900">
        {activeTurn ? `Round ${activeTurn.roundNumber}, pick ${activeTurn.pickNumber}` : `${Math.min(pickCursor, totalPicks)} of ${totalPicks} picks tracked`}
        {nextTurn ? ` · Next: ${nextName}` : ""}
      </p>
      <div className="mt-2 grid gap-1">
        {teams.map((team) => (
          <p className="truncate text-[11px] font-semibold text-emerald-950" key={team.key}>
            {turnDisplayName(team, playersById)}: {positionCountLabel(positionCounts.get(team.key) ?? [])}
          </p>
        ))}
      </div>
    </div>
  );
}

type DraftTurn = {
  team: DraftTeam;
  roundNumber: number;
  pickNumber: number;
  pickIndex: number;
};

function BalancedDraftBoard({
  activePickIndex,
  draftStarted,
  playersById,
  rounds
}: {
  activePickIndex: number;
  draftStarted: boolean;
  playersById: Map<string, TeamBuilderPlayer>;
  rounds: DraftTeam[][];
}) {
  const teamsPerRound = Math.max(rounds[0]?.length ?? 1, 1);
  const activeRoundIndex = Math.min(Math.floor(activePickIndex / teamsPerRound), Math.max(rounds.length - 1, 0));
  const [mobileRoundIndex, setMobileRoundIndex] = useState(activeRoundIndex);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const mobileRound = rounds[mobileRoundIndex] ?? [];
  const completedCounts = useMemo(() => completedPickPositionCounts(rounds, activePickIndex), [activePickIndex, rounds]);

  useEffect(() => {
    setMobileRoundIndex(activeRoundIndex);
  }, [activeRoundIndex]);

  return (
    <section className="panel p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListOrdered className="h-4 w-4 shrink-0 text-pitch" />
          <h2 className="section-title truncate">Balanced rotating draft order</h2>
        </div>
        <button
          className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm sm:hidden"
          onClick={() => setMobileExpanded((current) => !current)}
          type="button"
        >
          {mobileExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {mobileExpanded ? "Hide" : "Order"}
        </button>
      </div>
      <div className="grid gap-2 sm:hidden">
        <div className={cn("rounded-md border p-2", draftStarted && mobileRoundIndex === activeRoundIndex ? "border-emerald-200 bg-emerald-50" : "border-line bg-slate-50")}>
          <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase text-emerald-800">
            <button
              aria-label="Previous round"
              className="grid h-8 w-8 place-items-center rounded-md border border-emerald-200 bg-white text-emerald-800 shadow-sm disabled:opacity-40"
              disabled={mobileRoundIndex <= 0}
              onClick={() => setMobileRoundIndex((current) => Math.max(0, current - 1))}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-0 flex-1 truncate text-center normal-case">
              <span className="font-bold uppercase">Round {mobileRoundIndex + 1}</span>
              {draftStarted && mobileRoundIndex === activeRoundIndex ? <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-emerald-800">Active</span> : null}
            </span>
            <button
              aria-label="Next round"
              className="grid h-8 w-8 place-items-center rounded-md border border-emerald-200 bg-white text-emerald-800 shadow-sm disabled:opacity-40"
              disabled={mobileRoundIndex >= rounds.length - 1}
              onClick={() => setMobileRoundIndex((current) => Math.min(Math.max(rounds.length - 1, 0), current + 1))}
              type="button"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className={cn("flex flex-wrap gap-1.5", !mobileExpanded && "max-h-8 overflow-hidden")}>
            {mobileRound.map((team, pickIndex) => {
              const absolutePickIndex = mobileRoundIndex * teamsPerRound + pickIndex;
              const status = draftStarted ? draftPickStatus(absolutePickIndex, activePickIndex) : "pending";
              return (
                <span
                  className={cn(
                    "inline-flex min-w-20 flex-1 items-center justify-center gap-1.5 rounded-md bg-white px-2 py-1 text-center text-xs font-semibold text-emerald-950 ring-1 ring-emerald-100",
                    status === "done" && "bg-slate-100 text-slate-500 ring-slate-200",
                    status === "now" && "bg-emerald-900 text-white ring-emerald-900"
                  )}
                  key={`${team.key}-${pickIndex}`}
                >
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black", orderNumberClass(pickIndex))}>{completedPositionCount(completedCounts, team.key, pickIndex)}x</span>
                  <span className={cn("min-w-0 truncate", status === "done" && "line-through")}>{turnDisplayName(team, playersById)}</span>
                  {status === "done" ? <span className="text-[10px] font-black no-underline">Done</span> : null}
                  {status === "now" ? <span className="text-[10px] font-black">Now</span> : null}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <div className="hidden gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-4">
        {rounds.map((round, roundIndex) => (
          <div
            className={cn(
              "rounded-md border bg-slate-50 p-2",
              draftStarted && roundIndex === activeRoundIndex ? "border-emerald-200 bg-emerald-50 ring-1 ring-emerald-100" : "border-line"
            )}
            key={`${roundIndex}-${round.map((team) => team.key).join("-")}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase text-slate-500">
              <span>Round {roundIndex + 1}</span>
              {draftStarted && roundIndex === activeRoundIndex ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800">Active</span> : null}
            </div>
            <div className="grid gap-1.5">
              {round.map((team, pickIndex) => {
                const absolutePickIndex = roundIndex * Math.max(round.length, 1) + pickIndex;
                const status = draftStarted ? draftPickStatus(absolutePickIndex, activePickIndex) : "pending";
                return (
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded bg-white px-2 py-1.5 text-xs ring-1 ring-line",
                      status === "now" && "bg-emerald-900 font-semibold text-white ring-emerald-900",
                      status === "done" && "bg-slate-100 text-slate-400"
                    )}
                    key={`${team.key}-${pickIndex}`}
                  >
                    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black", orderNumberClass(pickIndex))}>{completedPositionCount(completedCounts, team.key, pickIndex)}x</span>
                    <span className={cn("min-w-0 flex-1 truncate text-center", status === "done" && "line-through")}>{turnDisplayName(team, playersById)}</span>
                    {status === "done" ? <span className="text-[10px] font-black uppercase">Done</span> : null}
                    {status === "now" ? <span className="text-[10px] font-black uppercase">Now</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
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
  armed = false,
  draggable = false,
  dragging = false,
  highlighted = false,
  grow = false,
  onClick,
  onDrag,
  onDragEnd,
  onDragStart,
  onPointerCancel,
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
  player,
  previewed = false,
  selected = false
}: {
  armed?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  grow?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
  onDrag?: (event: DragEvent) => void;
  onDragEnd?: () => void;
  onDragStart?: (event: DragEvent) => void;
  onPointerCancel?: () => void;
  onPointerDown?: (event: PointerEvent) => void;
  onPointerLeave?: () => void;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;
  player: TeamBuilderPlayer;
  previewed?: boolean;
  selected?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 min-w-0 select-none flex-wrap items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition duration-150 hover:border-emerald-200 hover:bg-emerald-50 sm:min-h-9 sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm",
        grow && "flex-1",
        draggable && "cursor-grab active:cursor-grabbing",
        armed && "scale-105 border-pitch bg-emerald-50 text-emerald-950 shadow-md ring-2 ring-emerald-100",
        dragging && "scale-110 border-pitch bg-pitch text-white opacity-80 shadow-lg ring-4 ring-emerald-100",
        previewed && "animate-pick-pulse border-amber-300 bg-amber-50 text-amber-950 ring-2 ring-amber-100",
        (highlighted || selected) && "border-amber-300 bg-amber-50 text-amber-950 ring-2 ring-amber-100"
      )}
      draggable={draggable}
      onClick={onClick}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      onKeyDown={onClick ? (event) => activateChipFromKeyboard(event, onClick) : undefined}
      onDragStart={onDragStart}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="truncate">{player.name}</span>
      <SkillBadges player={player} />
    </span>
  );
}

function PoolPlayerSelect({
  activeTeamKey,
  highlighted,
  onAssign,
  player,
  playersById,
  playersPerTeam,
  restrictToActiveTurn = false,
  teams
}: {
  activeTeamKey?: string;
  highlighted?: boolean;
  onAssign: (teamKey: string) => void;
  player: TeamBuilderPlayer;
  playersById: Map<string, TeamBuilderPlayer>;
  playersPerTeam: number;
  restrictToActiveTurn?: boolean;
  teams: DraftTeam[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        className={cn(
          "inline-flex min-h-8 max-w-72 items-center justify-between gap-2 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm outline-none transition hover:border-emerald-200 hover:bg-emerald-50 focus:border-pitch focus:ring-2 focus:ring-emerald-100 sm:min-h-9 sm:px-3 sm:py-1.5 sm:text-sm",
          highlighted && "border-amber-300 bg-amber-50 text-amber-950 ring-2 ring-amber-100"
        )}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="truncate">{player.name}</span>
          <SkillBadges player={player} />
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 grid min-w-72 overflow-hidden rounded-md border border-line bg-white text-xs font-semibold text-slate-700 shadow-lg">
          <div className="flex min-w-0 items-center gap-2 border-b border-line bg-slate-50 px-3 py-2">
            <span className="truncate">{player.name}</span>
            <SkillBadges player={player} />
          </div>
          <div className="grid max-h-64 overflow-auto p-1">
            {teams.map((team) => {
              const isCurrentTurn = !restrictToActiveTurn || team.key === activeTeamKey;
              const isFull = team.playerIds.length >= playersPerTeam;
              const disabled = !isCurrentTurn || isFull;
              const label = teamOptionLabel(team, playersById);
              return (
                <button
                  className={cn(
                    "rounded px-3 py-2 text-left transition",
                    disabled ? "cursor-not-allowed text-slate-400" : "hover:bg-emerald-50 hover:text-pitch"
                  )}
                  disabled={disabled}
                  key={team.key}
                  onClick={() => {
                    onAssign(team.key);
                    setOpen(false);
                  }}
                  type="button"
                >
                  {label}{restrictToActiveTurn ? isCurrentTurn ? " (current turn)" : " (waiting)" : ""}{isFull ? " - full" : ""}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SkillBadges({ player }: { player: TeamBuilderPlayer }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-slate-50 px-1 py-0.5 text-[10px] font-black leading-none">
      <SkillToken label="A" value={player.attackingSkillPercent} />
      <span className="px-0.5 text-slate-300">|</span>
      <SkillToken label="D" value={player.defendingSkillPercent} />
      <span className="px-0.5 text-slate-300">|</span>
      <SkillToken label="G" value={player.goalkeepingSkillPercent} />
    </span>
  );
}

function SkillToken({ label, value }: { label: string; value?: number | null }) {
  return (
    <span className={cn("min-w-5 text-center", skillValueClass(value))}>
      {label}{typeof value === "number" ? value : "-"}
    </span>
  );
}

function skillValueClass(value?: number | null) {
  if (typeof value !== "number") return "text-slate-500";
  if (value > 80) return "text-orange-600";
  if (value >= 50) return "text-emerald-700";
  return "text-amber-600";
}

function DraftAutosaveStatus({ status, updatedAt }: { status: DraftSaveStatus; updatedAt: string | null }) {
  if (status === "idle" && !updatedAt) return null;
  const label = status === "saving"
    ? "Autosaving draft..."
    : status === "error"
      ? "Draft autosave failed"
      : updatedAt
        ? "Draft autosaved"
        : "Draft ready";
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold",
        status === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      )}
      title={updatedAt ? `Last autosaved ${new Date(updatedAt).toISOString()}` : undefined}
    >
      {status === "saving" ? <RadioTower className="h-3.5 w-3.5 animate-pulse" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

function FloatingDragPreview({
  action,
  playersById
}: {
  action: LiveAction;
  playersById: Map<string, TeamBuilderPlayer>;
}) {
  const player = action.playerId ? playersById.get(action.playerId) : undefined;
  if (!player) return null;
  return (
    <div
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-md border border-pitch bg-pitch px-3 py-1.5 text-sm font-semibold text-white opacity-90 shadow-xl ring-4 ring-emerald-100"
      style={{
        left: `${typeof action.xPct === "number" ? action.xPct : 50}%`,
        top: `${typeof action.yPct === "number" ? action.yPct : 50}%`
      }}
    >
      {player.name}
    </div>
  );
}

function createLiveAction(
  kind: LiveAction["kind"],
  message: string,
  detail: Pick<LiveAction, "playerId" | "teamKey" | "xPct" | "yPct"> = {}
) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind,
    message,
    createdAt: Date.now(),
    ...detail
  };
}

function dragPosition(event: DragEvent) {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  return {
    xPct: clamp((event.clientX / width) * 100, 4, 96),
    yPct: clamp((event.clientY / height) * 100, 4, 96)
  };
}

function pointerPosition(event: PointerEvent) {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  return {
    xPct: clamp((event.clientX / width) * 100, 4, 96),
    yPct: clamp((event.clientY / height) * 100, 4, 96)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function turnDisplayName(team: DraftTeam, playersById: Map<string, TeamBuilderPlayer>) {
  return team.captainPlayerId ? playersById.get(team.captainPlayerId)?.name ?? team.name : team.name;
}

function teamOptionLabel(team: DraftTeam, playersById: Map<string, TeamBuilderPlayer>) {
  const captainName = team.captainPlayerId ? playersById.get(team.captainPlayerId)?.name : null;
  return captainName && captainName !== team.name ? `${team.name} - ${captainName}` : captainName ?? team.name;
}

function activateChipFromKeyboard(event: KeyboardEvent, onClick: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onClick();
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-100 sm:gap-1.5 sm:px-2.5 sm:text-xs">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      {label}: {value}
    </span>
  );
}

function PresenceMetric({ counts }: { counts: PresenceCounts }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-emerald-900 ring-1 ring-emerald-100 sm:gap-1.5 sm:px-2.5 sm:text-xs">
      <Users className="h-3.5 w-3.5 text-emerald-600" />
      {counts.total} watching
      {counts.editors ? ` · ${counts.editors} editing` : ""}
    </span>
  );
}

function initialTeams(existingTeams: TeamBuilderTeam[], fallbackCount: number, availablePlayers: TeamBuilderPlayer[]) {
  const availablePlayerIds = new Set(availablePlayers.map((player) => player.id));
  if (existingTeams.length) {
    return existingTeams.map((team, index) => {
      const playerIds = availableTeamPlayerIds(team.players.map((player) => player.id), availablePlayerIds);
      return {
        key: team.id ?? `existing-team-${index}`,
        name: team.name,
        captainPlayerId: team.captainPlayerId && playerIds.includes(team.captainPlayerId) ? team.captainPlayerId : "",
        playerIds
      };
    });
  }

  return Array.from({ length: fallbackCount }, (_, index) => ({
    key: `team-${index + 1}`,
    name: `Team ${index + 1}`,
    captainPlayerId: "",
    playerIds: []
  }));
}

function initialDraftTeams(draftTeams: DraftSnapshotTeam[] | undefined, existingTeams: TeamBuilderTeam[], fallbackCount: number, availablePlayers: TeamBuilderPlayer[]) {
  const availablePlayerIds = new Set(availablePlayers.map((player) => player.id));
  if (Array.isArray(draftTeams) && draftTeams.length) {
    return draftTeams.map((team, index) => {
      const playerIds = availableTeamPlayerIds(team.playerIds, availablePlayerIds);
      return {
        key: team.id ?? team.key ?? `team-${index + 1}`,
        name: team.name?.trim() || `Team ${index + 1}`,
        captainPlayerId: team.captainPlayerId && playerIds.includes(team.captainPlayerId) ? team.captainPlayerId : "",
        playerIds
      };
    });
  }

  return initialTeams(existingTeams, fallbackCount, availablePlayers);
}

function serializeDraftTeams(teams: DraftTeam[]) {
  return teams.map((team) => ({
    id: isUuid(team.key) ? team.key : undefined,
    key: team.key,
    name: team.name,
    captainPlayerId: team.captainPlayerId || null,
    playerIds: team.playerIds
  }));
}

function availableTeamPlayerIds(playerIds: string[] | undefined, availablePlayerIds: Set<string>) {
  const seen = new Set<string>();
  return (playerIds ?? []).filter((playerId) => {
    if (!playerId || !availablePlayerIds.has(playerId) || seen.has(playerId)) return false;
    seen.add(playerId);
    return true;
  });
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

function getDraftTurn(rounds: DraftTeam[][], pickIndex: number): DraftTurn | null {
  const flat = rounds.flat();
  const team = flat[pickIndex];
  if (!team || !rounds[0]?.length) return null;
  const teamsPerRound = rounds[0].length;
  return {
    team,
    roundNumber: Math.floor(pickIndex / teamsPerRound) + 1,
    pickNumber: (pickIndex % teamsPerRound) + 1,
    pickIndex
  };
}

function draftPickStatus(pickIndex: number, activePickIndex: number) {
  if (pickIndex < activePickIndex) return "done";
  if (pickIndex === activePickIndex) return "now";
  return "upcoming";
}

function pickPositionCounts(rounds: DraftTeam[][]) {
  const counts = new Map<string, number[]>();
  rounds.forEach((round) => {
    round.forEach((team, position) => {
      const teamCounts = counts.get(team.key) ?? Array.from({ length: round.length }, () => 0);
      teamCounts[position] = (teamCounts[position] ?? 0) + 1;
      counts.set(team.key, teamCounts);
    });
  });
  return counts;
}

function completedPickPositionCounts(rounds: DraftTeam[][], activePickIndex: number) {
  const counts = new Map<string, number[]>();
  let absolutePickIndex = 0;
  rounds.forEach((round) => {
    round.forEach((team, position) => {
      if (absolutePickIndex < activePickIndex) {
        const teamCounts = counts.get(team.key) ?? Array.from({ length: round.length }, () => 0);
        teamCounts[position] = (teamCounts[position] ?? 0) + 1;
        counts.set(team.key, teamCounts);
      }
      absolutePickIndex += 1;
    });
  });
  return counts;
}

function completedPositionCount(counts: Map<string, number[]>, teamKey: string, position: number) {
  return counts.get(teamKey)?.[position] ?? 0;
}

function positionCountLabel(counts: number[]) {
  return counts.map((count, index) => `${ordinal(index + 1)} x${count}`).join(" · ");
}

function ordinal(value: number) {
  if (value === 1) return "1st";
  if (value === 2) return "2nd";
  if (value === 3) return "3rd";
  return `${value}th`;
}

function buildBalancedDraftRounds(teams: DraftTeam[], roundCount: number): DraftTeam[][] {
  if (!teams.length) return [];
  if (teams.length === 3) {
    const patterns = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [0, 1, 2],
      [0, 2, 1],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0]
    ];
    return Array.from({ length: roundCount }, (_, index) => patterns[index % patterns.length].map((teamIndex) => teams[teamIndex]).filter(Boolean));
  }

  const permutations = permuteTeams(teams);
  const positionCounts = new Map(teams.map((team) => [team.key, Array.from({ length: teams.length }, () => 0)]));
  const rounds: DraftTeam[][] = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    let best = permutations[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of permutations) {
      const score = candidate.reduce((total: number, team: DraftTeam, position: number) => {
        const counts = positionCounts.get(team.key) ?? [];
        const nextCount = (counts[position] ?? 0) + 1;
        return total + nextCount * nextCount + (rounds.at(-1)?.[position]?.key === team.key ? 2 : 0);
      }, 0);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    best.forEach((team, position) => {
      const counts = positionCounts.get(team.key);
      if (counts) counts[position] += 1;
    });
    rounds.push(best);
  }

  return rounds;
}

function permuteTeams(teams: DraftTeam[]): DraftTeam[][] {
  if (teams.length <= 1) return [teams];
  return teams.flatMap((team, index) => {
    const rest = [...teams.slice(0, index), ...teams.slice(index + 1)];
    return permuteTeams(rest).map((permutation) => [team, ...permutation]);
  });
}

function countPresence(state: Record<string, Array<{ role?: string }>>) {
  const presences = Object.values(state).flat();
  const editors = presences.filter((presence) => presence.role === "editor").length;
  const total = Math.max(1, presences.length);
  return {
    editors,
    total,
    viewers: Math.max(0, total - editors)
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
