"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Mic, Plus, Save, Trash2, X } from "lucide-react";
import { saveMiniGameScores } from "@/lib/actions/session-management";
import { parseVoiceScoringCommand, transcribeVoiceScoringAudio } from "@/lib/actions/voice-scoring";

type SaveActionResult = { success?: boolean; message?: string; error?: string } | null;
type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
type AudioContextConstructor = new () => AudioContext;
type ParsedVoiceScoringGoal = {
  assistName?: string;
  confidence?: "low" | "medium" | "high";
  goalCount?: number;
  goalType?: GoalInput["goalType"];
  matchNumber: number;
  scorerName: string;
};
type VoiceScoringPreviewGoal = ParsedVoiceScoringGoal & {
  assistPlayerId?: string;
  error?: string;
  gameKey?: string;
  scorerId?: string;
  warning?: string;
};
type VoiceScoringResult = {
  goals?: ParsedVoiceScoringGoal[];
  parser?: {
    engine: "llm" | "rule_based";
    provider: "openai" | "gemini" | "rule_based";
    model?: string;
    fallbackUsed?: boolean;
  };
  rawText?: string;
  warnings?: string[];
  error?: string;
};

export type TeamOption = {
  id: string;
  name: string;
  players: Array<{ id: string; name: string }>;
};

export type MatchInput = {
  key: string;
  matchNumber: number;
  displayOrder?: number;
  matchType?: "regular" | "final";
  teamAId?: string;
  teamBId?: string;
  teamASource?: "standings_rank_1";
  teamBSource?: "standings_rank_2";
  awayTeamId?: string;
  resultStatus?: "scheduled" | "played";
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  goals: GoalInput[];
};

type GoalInput = {
  key: string;
  scorerId: string;
  assistPlayerId: string;
  goalType: "goal" | "own_goal";
  goalCount: number;
};

export function MiniGameScoresForm({
  existingGames,
  heading = "Game scores",
  readOnly = false,
  readOnlyReason = "Scores are read-only for this session.",
  saveAction = saveMiniGameScores,
  sessionId,
  sessionLabel = "Session",
  teams
}: {
  existingGames: MatchInput[];
  heading?: string;
  readOnly?: boolean;
  readOnlyReason?: string;
  saveAction?: typeof saveMiniGameScores;
  sessionId: string;
  sessionLabel?: string;
  teams: TeamOption[];
}) {
  const [games, setGames] = useState<MatchInput[]>(() => existingGames.length ? existingGames : defaultGames(teams));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("All changes saved.");
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSamplesRef = useRef<Float32Array[]>([]);
  const audioSampleRateRef = useRef(44100);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPayloadRef = useRef<string | null>(null);
  const saveSequenceRef = useRef(0);
  const [voiceCommand, setVoiceCommand] = useState("");
  const [voiceParsePending, setVoiceParsePending] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceScoringResult | null>(null);
  const [voiceTranscribePending, setVoiceTranscribePending] = useState(false);
  const playersByTeam = useMemo(() => new Map(teams.map((team) => [team.id, team.players])), [teams]);
  const teamByPlayer = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams) {
      for (const player of team.players) map.set(player.id, team.id);
    }
    return map;
  }, [teams]);
  const resolvedGames = useMemo(() => resolveStandingSourceGames(games, teams, teamByPlayer), [games, teams, teamByPlayer]);
  const payload = resolvedGames.map((game, index) => ({
    matchNumber: game.matchNumber,
    displayOrder: game.matchNumber || index + 1,
    matchType: game.matchType ?? "regular",
    teamAId: game.teamAId,
    teamBId: game.teamBId,
    teamASource: game.teamASource,
    teamBSource: game.teamBSource,
    awayTeamId: game.awayTeamId === game.teamAId || game.awayTeamId === game.teamBId ? game.awayTeamId : undefined,
    resultStatus: hasScoredGoals(game) ? "played" : game.resultStatus,
    scheduledStartTime: game.scheduledStartTime || undefined,
    scheduledEndTime: game.scheduledEndTime || undefined,
    goals: game.goals
      .filter((goal) => goal.scorerId)
      .map((goal) => ({
        scorerId: goal.scorerId,
        assistPlayerId: goal.goalType === "own_goal" ? undefined : goal.assistPlayerId || undefined,
        sessionTeamId: inferScoringTeamId(goal, game, teamByPlayer),
        goalCount: goal.goalCount,
        goalType: goal.goalType
      }))
  }));
  const payloadJson = JSON.stringify(payload);
  const voiceContextJson = JSON.stringify({
    matches: resolvedGames
      .filter((game) => game.teamAId && game.teamBId)
      .map((game) => ({
        matchNumber: game.matchNumber,
        teams: [
          {
            name: teamDisplayName(teams, game, "a"),
            players: playersForTeam(playersByTeam, game.teamAId).map((player) => player.name)
          },
          {
            name: teamDisplayName(teams, game, "b"),
            players: playersForTeam(playersByTeam, game.teamBId).map((player) => player.name)
          }
        ]
      }))
  });
  const voicePreviewGoals = useMemo(
    () => buildVoicePreviewGoals(voiceResult?.goals ?? [], resolvedGames, teams, playersByTeam),
    [playersByTeam, resolvedGames, teams, voiceResult]
  );
  const validVoicePreviewGoals = voicePreviewGoals.filter((goal) => !goal.error && goal.gameKey && goal.scorerId);

  useEffect(() => {
    if (lastSavedPayloadRef.current === null) lastSavedPayloadRef.current = payloadJson;
  }, [payloadJson]);

  const saveNow = useCallback(async (showSuccessToast = false) => {
    if (readOnly) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!teams.length) {
      const message = "Create teams before saving game scores.";
      setSaveStatus("error");
      setSaveMessage(message);
      toast.error(message);
      return;
    }
    if (payloadJson === lastSavedPayloadRef.current) {
      setSaveStatus("saved");
      setSaveMessage("All changes saved.");
      if (showSuccessToast) toast.success("Scores already saved.");
      return;
    }

    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    setSaveStatus("saving");
    setSaveMessage("Saving changes...");

    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("gamesJson", payloadJson);

    let result: SaveActionResult;
    try {
      result = await saveAction(null, formData) as SaveActionResult;
      if (sequence !== saveSequenceRef.current) return;
    } catch (error) {
      if (sequence !== saveSequenceRef.current) return;
      const message = error instanceof Error ? error.message : "Could not save game scores.";
      setSaveStatus("error");
      setSaveMessage(message);
      toast.error(message);
      return;
    }

    if (result?.error) {
      setSaveStatus("error");
      setSaveMessage(result.error);
      toast.error(result.error);
      return;
    }

    lastSavedPayloadRef.current = payloadJson;
    setSaveStatus("saved");
    setSaveMessage(result?.message ?? "All changes saved.");
    if (showSuccessToast) toast.success(result?.message ?? "Scores saved.");
  }, [payloadJson, readOnly, saveAction, sessionId, teams.length]);

  useEffect(() => {
    if (readOnly || lastSavedPayloadRef.current === null || payloadJson === lastSavedPayloadRef.current) return;
    setSaveStatus("dirty");
    setSaveMessage("Unsaved changes. Saving shortly...");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void saveNow(false);
    }, 700);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [payloadJson, readOnly, saveNow]);

  useEffect(() => {
    return () => {
      cleanupVoiceRecording();
    };
  }, []);

  function updateGame(key: string, patch: Partial<MatchInput>) {
    setGames((current) => current.map((game) => game.key === key ? { ...game, ...patch } : game));
  }

  function updateGoal(gameKey: string, goalKey: string, patch: Partial<GoalInput>) {
    setGames((current) =>
      current.map((game) =>
        game.key === gameKey
          ? { ...game, goals: game.goals.map((goal) => goal.key === goalKey ? { ...goal, ...patch } : goal) }
          : game
      )
    );
  }

  function deleteGoal(game: MatchInput, goalKey: string) {
    if (!window.confirm("Delete this goal? This change will be saved automatically.")) return;
    updateGame(game.key, { goals: game.goals.filter((item) => item.key !== goalKey) });
  }

  async function parseVoiceCommand(commandText = voiceCommand) {
    const text = commandText.trim();
    if (!text) {
      toast.error("Enter or record a scoring command first.");
      return;
    }
    setVoiceParsePending(true);
    setVoiceResult(null);
    const formData = new FormData();
    formData.set("commandText", text);
    formData.set("contextJson", voiceContextJson);
    try {
      const result = await parseVoiceScoringCommand(formData);
      setVoiceResult(result);
      if (result.error) toast.error(result.error);
      if (!result.error && !(result.goals?.length)) toast.error("No goals were found in that command.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not parse voice scoring command.";
      setVoiceResult({ error: message });
      toast.error(message);
    } finally {
      setVoiceParsePending(false);
    }
  }

  async function startVoiceScoring() {
    const AudioContextConstructor = getAudioContextConstructor();
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextConstructor) {
      toast.error("Audio recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      audioSamplesRef.current = [];
      audioSampleRateRef.current = audioContext.sampleRate;
      audioContextRef.current = audioContext;
      audioProcessorRef.current = processor;
      audioSourceRef.current = source;
      audioStreamRef.current = stream;
      setVoiceRecording(true);
      setVoiceResult(null);

      processor.onaudioprocess = (event) => {
        audioSamplesRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      if (audioContext.state === "suspended") await audioContext.resume();
    } catch (error) {
      cleanupVoiceRecording();
      const message = error instanceof Error ? error.message : "Could not start audio recording.";
      setVoiceResult({ error: message });
      toast.error(message);
    }
  }

  function stopVoiceScoring() {
    const audioBlob = finishVoiceRecording();
    if (!audioBlob.size) {
      toast.error("No audio was recorded.");
      return;
    }
    void transcribeAndParseRecording(audioBlob);
  }

  function finishVoiceRecording() {
    const samples = audioSamplesRef.current;
    const sampleRate = audioSampleRateRef.current;
    cleanupVoiceRecording();
    setVoiceRecording(false);
    audioSamplesRef.current = [];
    if (!samples.length) return new Blob([], { type: "audio/wav" });
    return encodeWav(samples, sampleRate);
  }

  function cleanupVoiceRecording() {
    audioProcessorRef.current?.disconnect();
    audioSourceRef.current?.disconnect();
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    audioProcessorRef.current = null;
    audioSourceRef.current = null;
    audioStreamRef.current = null;
  }

  async function transcribeAndParseRecording(audioBlob: Blob) {
    setVoiceTranscribePending(true);
    setVoiceResult(null);
    const formData = new FormData();
    const audioType = audioBlob.type || "audio/wav";
    formData.set("audio", new File([audioBlob], `voice-scoring-${Date.now()}.${audioFileExtension(audioType)}`, { type: audioType }));
    formData.set("contextText", voiceTranscriptionContext(resolvedGames, teams, playersByTeam));
    try {
      const result = await transcribeVoiceScoringAudio(formData);
      if (result.error || !result.transcript) {
        const message = result.error ?? "Could not transcribe audio.";
        setVoiceResult({ error: message });
        toast.error(message);
        return;
      }
      setVoiceCommand(result.transcript);
      await parseVoiceCommand(result.transcript);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not transcribe audio.";
      setVoiceResult({ error: message });
      toast.error(message);
    } finally {
      setVoiceTranscribePending(false);
    }
  }

  function applyVoiceGoals() {
    if (!validVoicePreviewGoals.length) {
      toast.error("No valid parsed goals to add.");
      return;
    }
    setGames((current) =>
      current.map((game) => {
        const goalsForGame = validVoicePreviewGoals.filter((goal) => goal.gameKey === game.key && goal.scorerId);
        if (!goalsForGame.length) return game;
        return {
          ...game,
          goals: [
            ...goalsForGame.map((goal) => ({
              assistPlayerId: goal.goalType === "own_goal" ? "" : goal.assistPlayerId ?? "",
              goalCount: Math.max(1, Number(goal.goalCount ?? 1) || 1),
              goalType: goal.goalType === "own_goal" ? "own_goal" as const : "goal" as const,
              key: randomKey("voice-goal"),
              scorerId: goal.scorerId ?? ""
            })),
            ...game.goals
          ]
        };
      })
    );
    toast.success(`${validVoicePreviewGoals.length} voice goal${validVoicePreviewGoals.length === 1 ? "" : "s"} added.`);
    setVoiceResult(null);
    setVoiceCommand("");
  }

  return (
    <div className="grid gap-4 pb-4">
      <div className="panel grid gap-3 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="page-title">{heading}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {sessionLabel}: record goals, assists, and own goals against the saved fixture. Scores are calculated from goal events.
            </p>
            {readOnly ? <p className="mt-2 text-sm font-medium text-amber-700">{readOnlyReason}</p> : null}
          </div>
          {!readOnly ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                saveStatus === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : saveStatus === "saving" || saveStatus === "dirty"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`} aria-live="polite">
                {saveMessage}
              </div>
              <button
                className="btn-secondary min-h-9 px-3 text-xs"
                disabled={saveStatus === "saving" || !teams.length}
                onClick={() => void saveNow(true)}
                type="button"
              >
                <Save className="h-3.5 w-3.5" />
                {saveStatus === "saving" ? "Saving..." : "Save now"}
              </button>
            </div>
          ) : null}
        </div>
        {!readOnly ? (
          <div className="grid gap-3 rounded-md border border-line bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink">Voice scoring</h2>
                <p className="text-xs text-slate-500">Record or type multiple scoring commands, then review before adding.</p>
              </div>
              <button
                className={`btn-secondary min-h-9 px-3 text-xs ${voiceRecording ? "border-emerald-300 bg-emerald-50 text-emerald-800" : ""}`}
                disabled={voiceParsePending || voiceTranscribePending}
                onClick={() => voiceRecording ? stopVoiceScoring() : void startVoiceScoring()}
                type="button"
              >
                <Mic className="h-3.5 w-3.5" />
                {voiceRecording ? "Stop" : voiceTranscribePending ? "Transcribing..." : "Record"}
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
              <textarea
                className="input min-h-20 resize-y text-sm"
                onChange={(event) => {
                  setVoiceCommand(event.target.value);
                  setVoiceResult(null);
                }}
                placeholder="Example: Game five, goal by Imon assist by Morshadul. Goal by M Asad assist by Rokibul."
                value={voiceCommand}
              />
              <div className="flex flex-wrap gap-2 md:justify-end">
                <button className="btn-secondary min-h-9 px-3 text-xs" disabled={voiceParsePending || voiceTranscribePending || !voiceCommand.trim()} onClick={() => void parseVoiceCommand()} type="button">
                  {voiceParsePending ? "Parsing..." : "Parse"}
                </button>
                <button className="btn-secondary min-h-9 px-3 text-xs" disabled={!voiceCommand.trim() && !voiceResult} onClick={() => {
                  setVoiceCommand("");
                  setVoiceResult(null);
                }} type="button">
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
              </div>
            </div>
            {voiceResult ? (
              <div className={`grid gap-2 rounded-md border p-3 text-sm ${
                voiceResult.error
                  ? "border-red-200 bg-red-50 text-red-700"
                  : validVoicePreviewGoals.length
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">
                    {voiceResult.error ? "Could not process voice command" : `${validVoicePreviewGoals.length} valid goal${validVoicePreviewGoals.length === 1 ? "" : "s"} ready`}
                  </div>
                  {voiceResult.parser ? (
                    <div className="rounded-md bg-white/70 px-2 py-1 text-[11px] font-semibold">
                      Parsed by {voiceResult.parser.engine === "llm" ? "LLM based" : "Rule based"}
                    </div>
                  ) : null}
                </div>
                {voiceResult.error ? <p className="text-xs">{voiceResult.error}</p> : null}
                {voicePreviewGoals.length ? (
                  <div className="rounded-md border border-white/70 bg-white px-3 py-2 text-xs text-slate-700">
                    {validVoicePreviewGoals.length} of {voicePreviewGoals.length} parsed goal{voicePreviewGoals.length === 1 ? "" : "s"} can be added.
                    {voicePreviewGoals.length > validVoicePreviewGoals.length ? " Some parsed items could not be matched to this fixture." : ""}
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <button className="btn-secondary min-h-9 px-3 text-xs" disabled={!validVoicePreviewGoals.length} onClick={applyVoiceGoals} type="button">
                    <Check className="h-3.5 w-3.5" />
                    Add valid goals
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid gap-3">
        {resolvedGames.map((game, index) => {
          const selectablePlayers = uniquePlayers([
            ...playersForTeam(playersByTeam, game.teamAId),
            ...playersForTeam(playersByTeam, game.teamBId)
          ]);
          const gameScore = calculateGameScore(game, teamByPlayer);
          const teamAName = teamDisplayName(teams, game, "a");
          const teamBName = teamDisplayName(teams, game, "b");
          const awayTeamId = game.awayTeamId === game.teamAId || game.awayTeamId === game.teamBId ? game.awayTeamId : "";
          const homeTeamName = awayTeamId ? teamName(teams, awayTeamId === game.teamAId ? game.teamBId : game.teamAId) : "";
          const awayTeamName = awayTeamId ? teamName(teams, awayTeamId) : "";
          const previousGame = index > 0 ? games[index - 1] : null;
          const breakMinutes = minutesBetween(previousGame?.scheduledEndTime, game.scheduledStartTime);
          const scoredGoals = hasScoredGoals(game);
          const isPlayed = scoredGoals || game.resultStatus === "played";
          return (
            <Fragment key={game.key}>
            {breakMinutes > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                Break: {breakMinutes} min
              </div>
            ) : null}
            <section
              className="panel overflow-hidden"
              key={game.key}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-50 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-md bg-pitch text-xs font-black text-white">G{game.matchNumber}</div>
                  {game.scheduledStartTime && game.scheduledEndTime ? (
                    <div className="rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                      {formatTime(game.scheduledStartTime)}-{formatTime(game.scheduledEndTime)}
                    </div>
                  ) : null}
                  <div className="truncate text-sm font-semibold text-ink">{teamAName}</div>
                  <div className="grid h-8 min-w-16 place-items-center rounded-md border border-line bg-white px-2 text-base font-black text-ink">
                    {gameScore.teamAScore}-{gameScore.teamBScore}
                  </div>
                  <div className="truncate text-sm font-semibold text-ink">{teamBName}</div>
                  {game.matchType === "final" ? (
                    <div className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-pitch ring-1 ring-emerald-100">
                      Final
                    </div>
                  ) : null}
                  {awayTeamId ? (
                    <div className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-pitch ring-1 ring-emerald-100">
                      {homeTeamName} home | {awayTeamName} away
                    </div>
                  ) : null}
                </div>
                <button
                  aria-checked={isPlayed}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${
                    isPlayed
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-line bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50"
                  } disabled:cursor-not-allowed disabled:opacity-75`}
                  disabled={readOnly || scoredGoals}
                  onClick={() => updateGame(game.key, { resultStatus: isPlayed ? "scheduled" : "played" })}
                  role="switch"
                  type="button"
                >
                  <span className={`grid h-5 w-9 items-center rounded-full px-0.5 transition ${isPlayed ? "bg-emerald-600" : "bg-slate-300"}`}>
                    <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${isPlayed ? "translate-x-4" : "translate-x-0"}`} />
                  </span>
                  Played{scoredGoals ? " (auto)" : ""}
                </button>
              </div>

              <div className="grid gap-2 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Goals and assists</h3>
                    <p className="text-xs text-slate-500">{teamAName} vs {teamBName}</p>
                    {game.matchType === "final" && (!game.teamAId || !game.teamBId) ? (
                      <p className="text-xs font-medium text-amber-700">Final teams resolve from the current top two standings before saving.</p>
                    ) : null}
                  </div>
                  {!readOnly ? (
                    <button
                      className="btn-secondary min-h-8 px-3 text-xs"
                      onClick={() =>
                        updateGame(game.key, {
                          goals: [
                            { key: randomKey("goal"), scorerId: "", assistPlayerId: "", goalType: "goal", goalCount: 1 },
                            ...game.goals
                          ]
                        })
                      }
                      type="button"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add goal
                    </button>
                  ) : null}
                </div>
                {game.goals.map((goal) => {
                  const scorerTeamId = teamByPlayer.get(goal.scorerId) ?? "";
                  const assistPlayers = goal.scorerId && scorerTeamId ? playersForTeam(playersByTeam, scorerTeamId) : selectablePlayers;
                  return (
                    <div className="grid gap-2 rounded-md border border-line bg-slate-50 p-2" key={goal.key}>
                      <div className="grid gap-2 lg:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
                        <GoalTypeSelect disabled={readOnly} onChange={(value) => updateGoal(game.key, goal.key, { goalType: value, assistPlayerId: value === "own_goal" ? "" : goal.assistPlayerId })} value={goal.goalType} />
                        <PlayerSelect
                          disabled={readOnly || !game.teamAId || !game.teamBId}
                          label={goal.goalType === "own_goal" ? "Own goal by" : "Scorer"}
                          onChange={(value) => updateGoal(game.key, goal.key, { scorerId: value, assistPlayerId: "" })}
                          players={selectablePlayers}
                          value={goal.scorerId}
                        />
                        <PlayerSelect disabled={readOnly || goal.goalType === "own_goal"} label="Assist" onChange={(value) => updateGoal(game.key, goal.key, { assistPlayerId: value })} players={assistPlayers} value={goal.assistPlayerId} optional />
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="grid w-20 shrink-0 gap-1 text-xs font-semibold uppercase text-slate-500">
                          Count
                          <input className="input min-h-9 w-full px-2 text-center text-sm font-semibold disabled:bg-slate-100 disabled:text-slate-400" disabled={readOnly} min="1" onChange={(event) => updateGoal(game.key, goal.key, { goalCount: Number(event.target.value) })} type="number" value={goal.goalCount} />
                        </label>
                        {!readOnly ? (
                          <button className="btn-secondary min-h-9 w-11 shrink-0 px-0" onClick={() => deleteGoal(game, goal.key)} type="button" aria-label="Delete goal">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                        <div className="min-h-9 min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-2 text-xs text-slate-600">
                          Credit: <span className="font-semibold text-ink">{teamName(teams, inferScoringTeamId(goal, game, teamByPlayer))}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!game.goals.length ? <p className="text-sm text-slate-500">No goal details added for this game.</p> : null}
              </div>
            </section>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function GoalTypeSelect({ disabled = false, onChange, value }: { disabled?: boolean; onChange: (value: GoalInput["goalType"]) => void; value: GoalInput["goalType"] }) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase text-slate-500">
      Type
      <select className="input min-h-9 px-2 text-sm disabled:bg-slate-100 disabled:text-slate-400" disabled={disabled} onChange={(event) => onChange(event.target.value as GoalInput["goalType"])} value={value}>
        <option value="goal">Goal</option>
        <option value="own_goal">Own goal</option>
      </select>
    </label>
  );
}

function PlayerSelect({ className = "", disabled = false, label, onChange, optional = false, players, value }: { className?: string; disabled?: boolean; label: string; onChange: (value: string) => void; optional?: boolean; players: Array<{ id: string; name: string }>; value: string }) {
  return (
    <label className={`grid gap-1 text-xs font-semibold uppercase text-slate-500 ${className}`}>
      {label}
      <select className="input min-h-9 px-2 text-sm disabled:bg-slate-100 disabled:text-slate-400" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{optional ? "No assist" : "Select player"}</option>
        {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
      </select>
    </label>
  );
}

function defaultGames(_teams: TeamOption[]) {
  return [];
}

function uniquePlayers(players: Array<{ id: string; name: string }>) {
  return Array.from(new Map(players.map((player) => [player.id, player])).values()).sort((left, right) => left.name.localeCompare(right.name));
}

function playersForTeam(playersByTeam: Map<string, Array<{ id: string; name: string }>>, teamId?: string) {
  return teamId ? playersByTeam.get(teamId) ?? [] : [];
}

function randomKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function calculateGameScore(game: MatchInput, teamByPlayer: Map<string, string>) {
  return game.goals.reduce(
    (score, goal) => {
      const scoringTeamId = inferScoringTeamId(goal, game, teamByPlayer);
      const count = Math.max(1, Number(goal.goalCount ?? 1) || 1);
      if (scoringTeamId === game.teamAId) score.teamAScore += count;
      if (scoringTeamId === game.teamBId) score.teamBScore += count;
      return score;
    },
    { teamAScore: 0, teamBScore: 0 }
  );
}

function hasScoredGoals(game: MatchInput) {
  return game.goals.some((goal) => Boolean(goal.scorerId));
}

function inferScoringTeamId(goal: GoalInput, game: Pick<MatchInput, "teamAId" | "teamBId">, teamByPlayer: Map<string, string>) {
  const playerTeamId = teamByPlayer.get(goal.scorerId);
  if (goal.goalType === "own_goal") {
    if (playerTeamId === game.teamAId) return game.teamBId ?? "";
    if (playerTeamId === game.teamBId) return game.teamAId ?? "";
    return "";
  }
  return playerTeamId === game.teamAId || playerTeamId === game.teamBId ? playerTeamId : "";
}

function teamName(teams: TeamOption[], teamId?: string) {
  if (!teamId) return "-";
  return teams.find((team) => team.id === teamId)?.name ?? "-";
}

function teamDisplayName(teams: TeamOption[], game: MatchInput, side: "a" | "b") {
  const teamId = side === "a" ? game.teamAId : game.teamBId;
  const source = side === "a" ? game.teamASource : game.teamBSource;
  if (teamId) return teamName(teams, teamId);
  if (source === "standings_rank_1") return "1st place";
  if (source === "standings_rank_2") return "2nd place";
  return side === "a" ? "Team A" : "Team B";
}

function resolveStandingSourceGames(games: MatchInput[], teams: TeamOption[], teamByPlayer: Map<string, string>) {
  const standings = buildStandingsForResolution(games, teams, teamByPlayer);
  return games.map((game) => {
    if (game.matchType !== "final") return game;
    const teamAId = game.teamAId || (game.teamASource === "standings_rank_1" ? standings[0]?.teamId : undefined);
    const teamBId = game.teamBId || (game.teamBSource === "standings_rank_2" ? standings[1]?.teamId : undefined);
    return {
      ...game,
      teamAId,
      teamBId,
      awayTeamId: game.awayTeamId === teamAId || game.awayTeamId === teamBId ? game.awayTeamId : ""
    };
  });
}

function buildStandingsForResolution(games: MatchInput[], teams: TeamOption[], teamByPlayer: Map<string, string>) {
  const rows = new Map(teams.map((team) => [team.id, {
    teamId: team.id,
    name: team.name,
    played: 0,
    points: 0,
    goalsFor: 0,
    awayGoals: 0,
    goalDifference: 0
  }]));

  for (const game of games) {
    if (game.matchType === "final" || !game.teamAId || !game.teamBId) continue;
    if (game.resultStatus !== "played" && !hasScoredGoals(game)) continue;
    const score = calculateGameScore(game, teamByPlayer);
    const teamA = rows.get(game.teamAId);
    const teamB = rows.get(game.teamBId);
    if (!teamA || !teamB) continue;
    applyStandingResult(teamA, score.teamAScore, score.teamBScore, game.awayTeamId === game.teamAId);
    applyStandingResult(teamB, score.teamBScore, score.teamAScore, game.awayTeamId === game.teamBId);
  }

  return Array.from(rows.values()).sort((left, right) =>
    right.points - left.points ||
    right.goalDifference - left.goalDifference ||
    right.goalsFor - left.goalsFor ||
    right.awayGoals - left.awayGoals ||
    left.name.localeCompare(right.name)
  );
}

function applyStandingResult(row: { played: number; points: number; goalsFor: number; awayGoals: number; goalDifference: number }, goalsFor: number, goalsAgainst: number, isAway = false) {
  row.played += 1;
  row.goalsFor += goalsFor;
  if (isAway) row.awayGoals += goalsFor;
  row.goalDifference += goalsFor - goalsAgainst;
  if (goalsFor > goalsAgainst) row.points += 3;
  if (goalsFor === goalsAgainst) row.points += 1;
}

function parseTimeToMinutes(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function minutesBetween(start?: string | null, end?: string | null) {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (startMinutes == null || endMinutes == null) return 0;
  return Math.max(0, endMinutes - startMinutes);
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const audioWindow = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function audioFileExtension(mimeType: string) {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "webm";
}

function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function voiceTranscriptionContext(
  games: MatchInput[],
  teams: TeamOption[],
  playersByTeam: Map<string, Array<{ id: string; name: string }>>
) {
  const matchLines = games
    .filter((game) => game.teamAId && game.teamBId)
    .map((game) => {
      const players = uniquePlayers([
        ...playersForTeam(playersByTeam, game.teamAId),
        ...playersForTeam(playersByTeam, game.teamBId)
      ]).map((player) => player.name);
      return `Game ${game.matchNumber}: ${teamDisplayName(teams, game, "a")} vs ${teamDisplayName(teams, game, "b")}. Players: ${players.join(", ")}.`;
    });
  return [
    "Transcribe a soccer scoring command. Preserve player names and game numbers.",
    "Common phrases: goal by, assist by, own goal by, game one, game two, G1, G2.",
    ...matchLines
  ].join("\n");
}

function buildVoicePreviewGoals(
  goals: ParsedVoiceScoringGoal[],
  games: MatchInput[],
  teams: TeamOption[],
  playersByTeam: Map<string, Array<{ id: string; name: string }>>
): VoiceScoringPreviewGoal[] {
  return goals.map((goal) => {
    const game = games.find((item) => Number(item.matchNumber) === Number(goal.matchNumber));
    if (!game) return { ...goal, error: `Game ${goal.matchNumber} does not exist.` };
    const selectablePlayers = uniquePlayers([
      ...playersForTeam(playersByTeam, game.teamAId),
      ...playersForTeam(playersByTeam, game.teamBId)
    ]);
    const scorer = findPlayerByVoice(goal.scorerName, selectablePlayers);
    if (!scorer) {
      return {
        ...goal,
        error: `Could not match scorer "${goal.scorerName}" in ${teamName(teams, game.teamAId)} vs ${teamName(teams, game.teamBId)}.`
      };
    }
    const assist = goal.assistName ? findPlayerByVoice(goal.assistName, selectablePlayers) : null;
    if (goal.assistName && !assist) {
      return {
        ...goal,
        error: `Could not match assist "${goal.assistName}" in ${teamName(teams, game.teamAId)} vs ${teamName(teams, game.teamBId)}.`,
        gameKey: game.key,
        scorerId: scorer.id
      };
    }
    return {
      ...goal,
      assistName: assist?.name ?? goal.assistName,
      assistPlayerId: assist?.id,
      gameKey: game.key,
      goalCount: Math.max(1, Number(goal.goalCount ?? 1) || 1),
      goalType: goal.goalType === "own_goal" ? "own_goal" : "goal",
      scorerId: scorer.id,
      scorerName: scorer.name,
      warning: goal.confidence === "low" ? "Low confidence match. Review before adding." : undefined
    };
  });
}

function findPlayerByVoice(text: string, players: Array<{ id: string; name: string }>) {
  const normalizedText = ` ${normalizeVoiceText(text)} `;
  const scoredPlayers = players
    .map((player) => {
      const normalizedName = normalizeVoiceText(player.name);
      const nameParts = normalizedName.split(" ").filter(Boolean);
      if (!normalizedName) return { player, score: 0 };
      if (normalizedText.includes(` ${normalizedName} `)) return { player, score: 100 + normalizedName.length };
      const matchingParts = nameParts.filter((part) => normalizedText.includes(` ${part} `));
      if (matchingParts.length === nameParts.length && nameParts.length > 1) return { player, score: 80 + normalizedName.length };
      if (matchingParts.length && nameParts.length === 1) return { player, score: 70 + normalizedName.length };
      if (matchingParts.length) return { player, score: 40 + matchingParts.join("").length };
      return { player, score: 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scoredPlayers[0]?.player ?? null;
}

function normalizeVoiceText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
