import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../auth/AuthProvider";
import { LoadingView } from "../components/LoadingView";
import { SelectModal } from "../components/SelectModal";
import { mobileApi } from "../lib/api";
import { supabase } from "../lib/supabase";
import { colors } from "../theme";

const statuses = ["confirmed", "played", "absent", "dropped", "replacement", "waitlisted"];
type Row = { id: string; status: string; notes: string | null; players: any; sessions: any };

export function AttendanceScreen() {
  const { profile, activeProgram } = useAuth();
  const [rows, setRows] = useState<Row[]>([]); const [players, setPlayers] = useState<any[]>([]); const [sessions, setSessions] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState(""); const [playerId, setPlayerId] = useState(""); const [status, setStatus] = useState("confirmed"); const [notes, setNotes] = useState("");
  const [selector, setSelector] = useState<"session" | "player" | "status" | null>(null); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    if (!profile) return; refresh ? setRefreshing(true) : setLoading(true); setError(null);
    let sessionQuery = supabase.from("sessions").select("id,name,session_date").eq("organization_id", profile.organizationId).order("session_date", { ascending: false });
    if (activeProgram?.id) sessionQuery = sessionQuery.eq("program_id", activeProgram.id);
    const [sessionResult, playerResult, attendanceResult] = await Promise.all([
      sessionQuery,
      supabase.from("players").select("id,display_name,status").eq("organization_id", profile.organizationId).eq("status", "active").order("display_name"),
      supabase.from("attendance").select("id,status,notes,players(display_name),sessions(session_date)").eq("organization_id", profile.organizationId).order("created_at", { ascending: false }).limit(100)
    ]);
    const firstError = [sessionResult.error, playerResult.error, attendanceResult.error].find(Boolean);
    if (firstError) setError(firstError.message); else { setSessions(sessionResult.data ?? []); setPlayers(playerResult.data ?? []); setRows((attendanceResult.data ?? []) as Row[]); }
    setLoading(false); setRefreshing(false);
  }, [activeProgram?.id, profile]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const options = useMemo(() => selector === "session" ? sessions.map((item) => ({ value: item.id, label: item.name ?? item.session_date, detail: item.session_date })) : selector === "player" ? players.map((item) => ({ value: item.id, label: item.display_name })) : statuses.map((item) => ({ value: item, label: titleCase(item) })), [players, selector, sessions]);
  if (loading) return <LoadingView error={error} />;
  async function save() { if (!profile || !sessionId || !playerId) return; setSaving(true); try { await mobileApi("/attendance", { method: "POST", body: JSON.stringify({ organizationId: profile.organizationId, sessionId, playerId, status, notes: notes.trim() || null }) }); setNotes(""); await load(true); Alert.alert("Saved", "Attendance and session usage are synchronized."); } catch (saveError) { Alert.alert("Could not save", saveError instanceof Error ? saveError.message : "Unknown error"); } finally { setSaving(false); } }
  return <FlatList contentContainerStyle={styles.content} data={rows} keyExtractor={(item) => item.id} refreshControl={<RefreshControl onRefresh={() => void load(true)} refreshing={refreshing} tintColor={colors.pitch} />} ListHeaderComponent={<View style={styles.form}>
    <Text style={styles.formTitle}>Update attendance</Text>
    <SelectButton label="Session" value={labelFor(sessions, sessionId, "name", "session_date")} onPress={() => setSelector("session")} />
    <SelectButton label="Player" value={labelFor(players, playerId, "display_name")} onPress={() => setSelector("player")} />
    <SelectButton label="Status" value={titleCase(status)} onPress={() => setSelector("status")} />
    <TextInput onChangeText={setNotes} placeholder="Notes (optional)" placeholderTextColor={colors.muted} style={styles.input} value={notes} />
    <Pressable disabled={saving || !sessionId || !playerId} onPress={() => void save()} style={[styles.save, (saving || !sessionId || !playerId) && styles.disabled]}><Text style={styles.saveText}>{saving ? "Saving…" : "Save attendance"}</Text></Pressable>
    <SelectModal onChange={(value) => selector === "session" ? setSessionId(value) : selector === "player" ? setPlayerId(value) : setStatus(value)} onClose={() => setSelector(null)} options={options} title={selector ? `Select ${selector}` : "Select"} value={selector === "session" ? sessionId : selector === "player" ? playerId : status} visible={selector !== null} />
    {error ? <Text style={styles.error}>{error}</Text> : null}<Text style={styles.listTitle}>Recent attendance</Text>
  </View>} renderItem={({ item }) => <View style={styles.row}><View style={styles.rowText}><Text style={styles.rowTitle}>{relationName(item.players) ?? "Unknown player"}</Text><Text style={styles.rowMeta}>{relationDate(item.sessions) ?? "No date"}</Text></View><Text style={styles.badge}>{titleCase(item.status)}</Text></View>} />;
}

function SelectButton({ label, value, onPress }: { label: string; value: string; onPress(): void }) { return <Pressable onPress={onPress} style={styles.select}><View><Text style={styles.selectLabel}>{label}</Text><Text style={styles.selectValue}>{value || `Select ${label.toLowerCase()}`}</Text></View><Text style={styles.chevron}>›</Text></Pressable>; }
function labelFor(rows: any[], id: string, key: string, fallback?: string) { const row = rows.find((item) => item.id === id); return row?.[key] ?? (fallback ? row?.[fallback] : "") ?? ""; }
function relationName(value: any) { const row = Array.isArray(value) ? value[0] : value; return row?.display_name ?? null; } function relationDate(value: any) { const row = Array.isArray(value) ? value[0] : value; return row?.session_date ?? null; } function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, backgroundColor: colors.background }, form: { marginBottom: 18, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, formTitle: { marginBottom: 14, color: colors.ink, fontSize: 19, fontWeight: "900" }, select: { minHeight: 59, marginBottom: 10, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.line, borderRadius: 12 }, selectLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }, selectValue: { marginTop: 4, color: colors.ink, fontWeight: "700" }, chevron: { color: colors.pitch, fontSize: 28 }, input: { minHeight: 50, marginBottom: 10, paddingHorizontal: 14, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 12 }, save: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.pitch }, disabled: { opacity: 0.45 }, saveText: { color: "white", fontWeight: "900" }, error: { marginTop: 10, color: colors.danger }, listTitle: { marginTop: 24, color: colors.ink, fontSize: 18, fontWeight: "900" }, row: { minHeight: 68, marginBottom: 9, padding: 14, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.surface }, rowText: { flex: 1 }, rowTitle: { color: colors.ink, fontWeight: "800" }, rowMeta: { marginTop: 4, color: colors.muted }, badge: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, color: colors.pitch, backgroundColor: colors.pitchSoft, fontSize: 10, fontWeight: "900" }
});
