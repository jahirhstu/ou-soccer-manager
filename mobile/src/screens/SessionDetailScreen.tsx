import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LoadingView } from "../components/LoadingView";
import { supabase } from "../lib/supabase";
import type { RootStackParamList } from "../navigation/types";
import { colors } from "../theme";
import { useAuth } from "../auth/AuthProvider";

type Detail = { session: any; attendance: any[]; teams: any[]; matches: any[]; goals: any[] };

export function SessionDetailScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "SessionDetail">) {
  const { profile } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    else setDetail({ session: sessionResult.data, attendance: attendanceResult.data ?? [], teams: teamsResult.data ?? [], matches: matchesResult.data ?? [], goals: goalsResult.data ?? [] });
    setLoading(false); setRefreshing(false);
  }, [route.params.sessionId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading || !detail) return <LoadingView error={error} />;
  const { session } = detail;
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl onRefresh={() => void load(true)} refreshing={refreshing} tintColor={colors.pitch} />}>
    <View style={styles.hero}><Text style={styles.title}>{session.name ?? session.session_date}</Text><Text style={styles.meta}>{session.session_date} · {relationName(session.playgrounds) ?? session.location ?? "No field"}</Text><Text style={styles.status}>{session.status}</Text></View>
    {profile?.role === "admin" || profile?.role === "captain" ? <View style={styles.actions}><Pressable onPress={() => navigation.navigate("Teams", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Teams</Text></Pressable><Pressable onPress={() => navigation.navigate("Fixture", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Fixture</Text></Pressable><Pressable onPress={() => navigation.navigate("Scores", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Scores</Text></Pressable></View> : null}
    {profile?.playerId ? <View style={styles.actions}><Pressable onPress={() => navigation.navigate("Lineups", { sessionId: route.params.sessionId })} style={styles.action}><Text style={styles.actionText}>Lineups</Text></Pressable></View> : null}
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
  actions: { marginTop: 12, flexDirection: "row", gap: 8 }, action: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.pitchSoft }, actionText: { color: colors.pitch, fontWeight: "900" }, section: { marginTop: 18, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.surface }, sectionTitle: { marginBottom: 10, color: colors.ink, fontSize: 18, fontWeight: "900" }, row: { paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }, rowTitle: { color: colors.ink, fontWeight: "800" }, rowValue: { marginTop: 4, color: colors.muted, lineHeight: 19 }, empty: { color: colors.muted }
});
