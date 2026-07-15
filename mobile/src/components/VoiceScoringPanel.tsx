import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useAuth } from "../auth/AuthProvider";
import { mobileFormApi } from "../lib/api";
import { colors } from "../theme";

export type ParsedVoiceGoal = { matchNumber: number; scorerName: string; assistName?: string; goalType?: "goal" | "own_goal"; goalCount?: number };
type Context = { matches: Array<{ matchNumber: number; teams: Array<{ name: string; players: string[] }> }> };

export function VoiceScoringPanel({ sessionId, context, onApply }: { sessionId: string; context: Context; onApply(goals: ParsedVoiceGoal[]): void }) {
  const { profile } = useAuth();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [command, setCommand] = useState("");
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<ParsedVoiceGoal[]>([]);

  async function start() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return Alert.alert("Microphone access required", "Allow microphone access to record scoring commands.");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stop() {
    setProcessing(true);
    try {
      await recorder.stop();
      if (!recorder.uri || !profile) throw new Error("No audio recording was created.");
      const body = baseForm(profile.organizationId, sessionId, "transcribe");
      body.append("contextText", context.matches.map((match) => `Game ${match.matchNumber}: ${match.teams.map((team) => `${team.name}: ${team.players.join(", ")}`).join(" vs ")}`).join("\n"));
      body.append("audio", { uri: recorder.uri, name: `voice-score-${Date.now()}.m4a`, type: "audio/mp4" } as any);
      const result = await mobileFormApi<{ transcript?: string; error?: string }>("/voice-scoring", body);
      if (result.error || !result.transcript) throw new Error(result.error ?? "Transcription returned no text.");
      setCommand(result.transcript);
      await parse(result.transcript);
    } catch (error) { Alert.alert("Voice scoring failed", message(error)); }
    finally { await setAudioModeAsync({ allowsRecording: false }); setProcessing(false); }
  }

  async function parse(text = command) {
    if (!profile || !text.trim()) return;
    setProcessing(true);
    try {
      const body = baseForm(profile.organizationId, sessionId, "parse");
      body.append("commandText", text.trim());
      body.append("contextJson", JSON.stringify(context));
      const result = await mobileFormApi<{ goals?: ParsedVoiceGoal[]; error?: string }>("/voice-scoring", body);
      if (result.error) throw new Error(result.error);
      setPreview(result.goals ?? []);
    } catch (error) { Alert.alert("Could not parse command", message(error)); }
    finally { setProcessing(false); }
  }

  return <View style={styles.panel}><Text style={styles.title}>Voice scoring</Text><Text style={styles.help}>Say “Game one, Jahir scored, assisted by Mim.”</Text><View style={styles.actions}><Pressable disabled={processing} onPress={() => recorderState.isRecording ? void stop() : void start()} style={[styles.record, recorderState.isRecording && styles.recording]}><Text style={styles.recordText}>{recorderState.isRecording ? `Stop (${Math.round(recorderState.durationMillis / 1000)}s)` : processing ? "Processing…" : "Record"}</Text></Pressable><Pressable disabled={processing || !command.trim()} onPress={() => void parse()} style={styles.parse}><Text style={styles.parseText}>Parse text</Text></Pressable></View><TextInput multiline onChangeText={setCommand} placeholder="Or type a scoring command" placeholderTextColor={colors.muted} style={styles.input} value={command} />{preview.length ? <View style={styles.preview}><Text style={styles.previewTitle}>{preview.length} parsed goal{preview.length === 1 ? "" : "s"}</Text>{preview.map((goal, index) => <Text key={index} style={styles.goal}>Game {goal.matchNumber}: {goal.scorerName}{goal.assistName ? ` (${goal.assistName})` : ""}{goal.goalType === "own_goal" ? " · own goal" : ""}</Text>)}<Pressable onPress={() => { onApply(preview); setPreview([]); setCommand(""); }} style={styles.apply}><Text style={styles.applyText}>Add to scores</Text></Pressable></View> : null}</View>;
}

function baseForm(organizationId: string, sessionId: string, action: string) { const form = new FormData(); form.append("organizationId", organizationId); form.append("sessionId", sessionId); form.append("action", action); return form; }
function message(error: unknown) { return error instanceof Error ? error.message : "Unexpected error."; }
const styles = StyleSheet.create({ panel: { marginTop: 14, padding: 15, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.surface }, title: { color: colors.ink, fontSize: 18, fontWeight: "900" }, help: { marginTop: 5, color: colors.muted }, actions: { marginTop: 11, flexDirection: "row", gap: 8 }, record: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: colors.pitch }, recording: { backgroundColor: colors.danger }, recordText: { color: "white", fontWeight: "900" }, parse: { paddingHorizontal: 13, justifyContent: "center", borderRadius: 9, backgroundColor: colors.pitchSoft }, parseText: { color: colors.pitch, fontWeight: "900" }, input: { minHeight: 68, marginTop: 10, padding: 10, color: colors.ink, textAlignVertical: "top", borderWidth: 1, borderColor: colors.line, borderRadius: 9 }, preview: { marginTop: 11, padding: 11, borderRadius: 9, backgroundColor: "#F8FAFC" }, previewTitle: { color: colors.ink, fontWeight: "900" }, goal: { marginTop: 5, color: colors.muted }, apply: { minHeight: 42, marginTop: 10, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.pitch }, applyText: { color: "white", fontWeight: "900" } });
