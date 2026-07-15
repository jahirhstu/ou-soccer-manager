import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LoadingView } from "../components/LoadingView";
import { supabase } from "../lib/supabase";
import type { RootStackParamList } from "../navigation/types";
import { colors } from "../theme";
import { useAuth } from "../auth/AuthProvider";
import { mobileApi } from "../lib/api";

type Detail = { session: any; attendance: any[]; teams: any[]; matches: any[]; goals: any[] };

export function SessionDetailScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "SessionDetail">) {
  const { profile } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState(""); const [saving, setSaving] = useState(false);
  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    const id = route.params.sessionId;
    const [sessionResult, attendanceResult, teamsResult, matchesResult, goalsResult] = await Promise.all([
      supabase.from("sessions").select("*,seasons(name),playgrounds(name)").eq("id", id).single(),
      supabase.from("attendance").select("status,notes,players(display_name)").eq("session_id", id),
      supabase.from("session_teams").select("id,name,captain:players!session_teams_captain_player_id_fkey(display_name),session_team_players(players(display_name))").eq("session_id", id).order("name"),
      supabase.from("session_matches").select("id,match_number,team_a_score,team_b_score,team_a:session_teams!session_matches_team_a_id_fkey(name),team_b:session_teams!session_matches_team_b_id_fkey(name)").eq("session_id", id).order("match_number"),
      supabase.from("goals").select("goal_count,goal_type,scorer:players!goals_scorer_id_fkey(display_name),assist:players!goals_assist_player_id_fkey(display_name),session_teams(name)").eq("session_id", id)
    ]);
    const firstError = [sessionResult.error, attendanceResult.error, teamsResult.error, matchesResult.error, goalsResult.error].find(Boolean);
    if (firstError) setError(firstError.message);
    else { setDetail({ session: sessionResult.data, attendance: attendanceResult.data ?? [], teams: teamsResult.data ?? [], matches: matchesResult.data ?? [], goals: goalsResult.data ?? [] }); setPrice(sessionResult.data?.price_per_session == null ? "" : String(sessionResult.data.price_per_session)); }
    setLoading(false); setRefreshing(false);
  }, [route.params.sessionId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading || !detail) return <LoadingView error={error} />;
  const { session } = detail;
  async function sessionAction(action: "complete" | "update_price") { if (!profile) return; const parsedPrice = price === "" ? null : Number(price); if (action === "update_price" && parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) return Alert.alert("Invalid price", "Enter zero or a positive amount."); setSaving(true); try { await mobileApi("/sessions", { method: "POST", body: JSON.stringify({ organizationId: profile.organizationId, sessionId: route.params.sessionId, action, data: action === "update_price" ? { price: parsedPrice } : {} }) }); Alert.alert(action === "complete" ? "Session completed" : "Price updated", action === "complete" ? "Attendance usage and charges were applied." : "The session price override was saved."); await load(true); } catch (e) { Alert.alert("Could not update session", e instanceof Error ? e.message : "Unexpected error."); } finally { setSaving(false); } }
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl onRefresh={() => void load(true)} refreshing={refreshing} tintColor={colors.pitch} />}>
    <View style={styles.hero}><Text style={styles.title}>{session.name ?? session.session_date}</Text><Text style={styles.meta}>{session.session_date} · {relationName(session.playgrounds) ?? session.location ?? "No field"}</Text><Text style={styles.status}>{session.status}</Text></View>
    {profile?.role === "admin" || profile?.role === "captain" ? <View style={styles.actions}><Pressable onPress={() => navigation.navigate("Teams", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Teams</Text></Pressable><Pressable onPress={() => navigation.navigate("Fixture", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Fixture</Text></Pressable><Pressable onPress={() => navigation.navigate("Scores", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Scores</Text></Pressable><Pressable onPress={() => navigation.navigate("VoiceScores", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Voice</Text></Pressable></View> : null}
    {profile?.playerId ? <View style={styles.actions}><Pressable onPress={() => navigation.navigate("Lineups", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Lineups</Text></Pressable></View> : null}
    {profile?.role === "admin" ? <View style={styles.admin}><Text style={styles.sectionTitle}>Session billing</Text><TextInput keyboardType="decimal-pad" onChangeText={setPrice} placeholder="Use season price" placeholderTextColor={colors.muted} style={styles.price} value={price} /><Pressable disabled={saving} onPress={() => void sessionAction("update_price")} style={styles.adminButton}><Text style={styles.adminButtonText}>Save price</Text></Pressable>{session.status !== "completed" ? <Pressable disabled={saving} onPress={() => Alert.alert("Complete session?", "This applies attendance usage and player charges.", [{ text: "Cancel", style: "cancel" }, { text: "Complete", style: "destructive", onPress: () => void sessionAction("complete") }])} style={styles.complete}><Text style={styles.completeText}>Complete session</Text></Pressable> : null}</View> : null}
    <Section title="Game scores" empty="No games generated.">{detail.matches.map((match) => <Row key={match.id} title={`Game ${match.match_number}`} value={`${relationName(match.team_a) ?? "-"} ${match.team_a_score ?? 0}–${match.team_b_score ?? 0} ${relationName(match.team_b) ?? "-"}`} />)}</Section>
    <Section title="Teams" empty="No teams created.">{detail.teams.map((team) => <Row key={team.id} title={team.name} value={(team.session_team_players ?? []).map((item: any) => relationName(item.players)).filter(Boolean).join(", ") || "No players"} />)}</Section>
    <Section title="Goals & assists" empty="No goals recorded.">{detail.goals.map((goal, index) => <Row key={index} title={`${relationName(goal.scorer) ?? "Unknown"} × ${goal.goal_count ?? 1}`} value={relationName(goal.assist) ? `Assist: ${relationName(goal.assist)}` : "Unassisted"} />)}</Section>
    <Section title="Attendance" empty="No attendance recorded.">{detail.attendance.map((row, index) => <Row key={index} title={relationName(row.players) ?? "Unknown player"} value={row.status} />)}</Section>
  </ScrollView>;
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children); return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{hasChildren ? children : <Text style={styles.empty}>{empty}</Text>}</View>; }
function Row({ title, value }: { title: string; value: string }) { return <View style={styles.row}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowValue}>{value}</Text></View>; }
function relationName(value: any) { const row = Array.isArray(value) ? value[0] : value; return row?.display_name ?? row?.name ?? null; }
const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, backgroundColor: colors.background }, hero: { padding: 18, borderRadius: 16, backgroundColor: colors.pitch }, title: { color: "white", fontSize: 23, fontWeight: "900" }, meta: { marginTop: 7, color: "#D1FAE5" }, status: { alignSelf: "flex-start", marginTop: 12, paddingHorizontal: 9, paddingVertical: 5, overflow: "hidden", borderRadius: 999, color: colors.pitch, backgroundColor: "white", fontWeight: "900", textTransform: "uppercase", fontSize: 10 },
  actions: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }, action: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.pitchSoft }, actionText: { color: colors.pitch, fontWeight: "900" }, admin: { marginTop: 18, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.surface }, price: { minHeight: 48, paddingHorizontal: 13, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 10 }, adminButton: { marginTop: 10, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.pitch }, adminButtonText: { color: "white", fontWeight: "900" }, complete: { marginTop: 10, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#FEE2E2" }, completeText: { color: colors.danger, fontWeight: "900" }, section: { marginTop: 18, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.surface }, sectionTitle: { marginBottom: 10, color: colors.ink, fontSize: 18, fontWeight: "900" }, row: { paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }, rowTitle: { color: colors.ink, fontWeight: "800" }, rowValue: { marginTop: 4, color: colors.muted, lineHeight: 19 }, empty: { color: colors.muted }
});
