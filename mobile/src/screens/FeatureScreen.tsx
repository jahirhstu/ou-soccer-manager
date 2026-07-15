import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../auth/AuthProvider";
import { LoadingView } from "../components/LoadingView";
import { canWriteFeature, features, type FeatureKey } from "../features";
import { supabase } from "../lib/supabase";
import type { RootStackParamList } from "../navigation/types";
import { colors } from "../theme";

type DisplayRow = { id: string; title: string; subtitle?: string; detail?: string; search: string };

export function FeatureScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "Feature">) {
  const { profile, activeProgram } = useAuth();
  const feature = features.find((item) => item.key === route.params.featureKey);
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (!profile) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const result = await loadFeature(route.params.featureKey, profile.organizationId, activeProgram?.id ?? null);
      setRows(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this feature.");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [activeProgram?.id, profile, route.params.featureKey]);

  useFocusEffect(useCallback(() => { navigation.setOptions({ title: feature?.title ?? "Feature" }); void load(); }, [feature?.title, load, navigation]));
  const visibleRows = useMemo(() => rows.filter((row) => row.search.includes(search.trim().toLowerCase())), [rows, search]);
  if (loading) return <LoadingView error={error} />;
  return <FlatList
    contentContainerStyle={styles.content}
    data={visibleRows}
    keyExtractor={(item) => item.id}
    refreshControl={<RefreshControl onRefresh={() => void load(true)} refreshing={refreshing} tintColor={colors.pitch} />}
    ListHeaderComponent={<View><Text style={styles.heading}>{feature?.title}</Text><Text style={styles.intro}>{feature?.description}</Text>{profile && canCreate(route.params.featureKey) && canWriteFeature(profile.role, route.params.featureKey) ? <Pressable onPress={() => navigation.navigate("CreateRecord", { featureKey: route.params.featureKey as any })} style={styles.create}><Text style={styles.createText}>Add {feature?.title.toLowerCase()}</Text></Pressable> : null}{profile?.role === "admin" && route.params.featureKey === "payments" ? <Pressable onPress={() => navigation.navigate("Waiver")} style={styles.secondary}><Text style={styles.secondaryText}>Record fee waiver</Text></Pressable> : null}<TextInput onChangeText={setSearch} placeholder="Search" placeholderTextColor={colors.muted} style={styles.search} value={search} />{error ? <Text style={styles.error}>{error}</Text> : null}</View>}
    ListEmptyComponent={<Text style={styles.empty}>{error ? "Data could not be loaded." : "No records found."}</Text>}
    renderItem={({ item }) => <View style={styles.card}><Text style={styles.title}>{item.title}</Text>{item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}{item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}</View>}
  />;
}

function canCreate(key: FeatureKey): key is "programs" | "seasons" | "players" | "payments" | "expenses" { return ["programs", "seasons", "players", "payments", "expenses"].includes(key); }

async function loadFeature(key: FeatureKey, organizationId: string, programId: string | null): Promise<DisplayRow[]> {
  const config = queryConfig(key);
  if (!config) return [{ id: key, title: "Native workflow in progress", subtitle: "This operation requires its secured server mutation screen." , search: "native workflow" }];
  let query: any = supabase.from(config.table).select(config.select);
  if (!summaryViews.has(config.table)) query = query.eq("organization_id", organizationId);
  if (programId && config.programScoped) query = query.eq("program_id", programId);
  if (config.order) query = query.order(config.order, { ascending: config.ascending ?? false });
  if (config.limit) query = query.limit(config.limit);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any, index: number) => config.map(row, index));
}

const summaryViews = new Set(["player_season_payment_summary", "player_season_stats_summary", "player_playground_stats_summary"]);

function queryConfig(key: FeatureKey): QueryConfig | null {
  const configs: Partial<Record<FeatureKey, QueryConfig>> = {
    dashboard: cfg("sessions", "id,name,session_date,status,playgrounds(name)", "session_date", true, (r) => [r.name ?? r.session_date, `${r.session_date} · ${relation(r.playgrounds) ?? "No field"}`, title(r.status)]),
    programs: cfg("programs", "id,name,category,activity_type,status", "name", false, (r) => [r.name, `${title(r.category)} · ${r.activity_type}`, title(r.status)]),
    performance: cfg("player_performance_ratings", "id,rating,notes,players(display_name),sessions(name,session_date)", "created_at", true, (r) => [relation(r.players) ?? "Player", `Rating: ${r.rating}`, `${relation(r.sessions) ?? "Session"}${r.notes ? ` · ${r.notes}` : ""}`], true),
    leagues: cfg("leagues", "id,name,status,start_date,end_date", "created_at", true, (r) => [r.name, title(r.status), [r.start_date, r.end_date].filter(Boolean).join(" – ")], true),
    leaderboards: cfg("session_teams", "id,name,captain:players!session_teams_captain_player_id_fkey(display_name),sessions(name,session_date)", "created_at", true, (r) => [r.name, `Captain: ${relation(r.captain) ?? "-"}`, relation(r.sessions) ?? "Session"], true),
    fieldStats: cfg("player_playground_stats_summary", "*", "goals", true, (r, i) => [r.player_name ?? `Player ${i + 1}`, `${r.playground_name ?? "Field"} · ${r.goals ?? 0} goals`, `${r.assists ?? 0} assists · ${r.appearances ?? 0} appearances`]),
    seasons: cfg("seasons", "id,name,status,start_date,end_date,price_per_session,total_planned_sessions", "start_date", true, (r) => [r.name, `${title(r.status)} · $${number(r.price_per_session)}/session`, `${r.total_planned_sessions ?? 0} planned · ${r.start_date ?? "-"} – ${r.end_date ?? "-"}`], true),
    players: cfg("players", "id,display_name,email,phone,status,preferred_position", "display_name", false, (r) => [r.display_name, `${title(r.status)}${r.preferred_position ? ` · ${r.preferred_position}` : ""}`, r.email ?? r.phone ?? "No contact"]),
    users: cfg("organization_members", "id,role,player_id,profiles(display_name,email)", "created_at", true, (r) => [relation(r.profiles) ?? "User", title(r.role), relationValue(r.profiles, "email") ?? "No email"]),
    payments: cfg("payments", "id,amount,payment_date,payment_method,players(display_name),seasons(name)", "payment_date", true, (r) => [relation(r.players) ?? "Player", `$${number(r.amount)} · ${r.payment_date}`, `${r.payment_method ?? "Payment"} · ${relation(r.seasons) ?? "Season"}`], true),
    reminders: cfg("player_season_payment_summary", "*", "player_name", false, (r) => [r.player_name ?? "Player", `$${number(r.balance_amount ?? r.credit_amount)} balance`, `${r.remaining_sessions ?? 0} sessions remaining`]),
    notifications: cfg("notifications", "id,notification_type,amount,message,read_at,created_at,player:players(display_name),season:seasons(name)", "created_at", true, (r) => [r.message ?? title(r.notification_type), `${relation(r.player) ?? "Player"} · $${number(r.amount)}`, `${relation(r.season) ?? "Season"} · ${r.read_at ? "Read" : "Unread"}`]),
    expenses: cfg("club_expenses", "id,expense_date,category,amount,vendor,notes", "expense_date", true, (r) => [title(r.category), `$${number(r.amount)} · ${r.expense_date}`, [r.vendor, r.notes].filter(Boolean).join(" · ")], true),
    paymentReport: cfg("player_season_payment_summary", "*", "player_name", false, (r) => [r.player_name ?? "Player", `Paid $${number(r.total_paid_amount)} · Used $${number(r.estimated_used_amount)}`, `Balance $${number(r.balance_amount)} · ${r.remaining_sessions ?? 0} sessions`]),
    myStatus: cfg("player_season_payment_summary", "*", "player_name", false, (r) => [r.player_name ?? "Player", `${r.season_name ?? "Season"} · Balance $${number(r.balance_amount)}`, `${r.remaining_sessions ?? 0} sessions remaining`]),
    goalsAssists: cfg("player_season_stats_summary", "*", "goals", true, (r) => [r.player_name ?? "Player", `${r.goals ?? 0} goals · ${r.assists ?? 0} assists`, `${r.appearances ?? 0} appearances`]),
    publicSessions: cfg("sessions", "id,name,session_date,status,playgrounds(name)", "session_date", true, (r) => [r.name ?? r.session_date, `${r.session_date} · ${relation(r.playgrounds) ?? "No field"}`, title(r.status)], true),
    publicLeaderboards: cfg("session_teams", "id,name,captain:players!session_teams_captain_player_id_fkey(display_name),sessions(name,session_date)", "created_at", true, (r) => [r.name, `Captain: ${relation(r.captain) ?? "-"}`, relation(r.sessions) ?? "Session"], true),
    fieldStatus: cfg("playgrounds", "id,name,location,notes", "name", false, (r) => [r.name, r.location ?? "Location not set", r.notes ?? "No status note"])
  };
  return configs[key] ?? null;
}

type QueryConfig = { table: string; select: string; order?: string; ascending?: boolean; limit?: number; programScoped?: boolean; map(row: any, index: number): DisplayRow };
function cfg(table: string, select: string, order: string, descending: boolean, mapper: (row: any, index: number) => [string, string?, string?], programScoped = false): QueryConfig { return { table, select, order, ascending: !descending, programScoped, map(row, index) { const [rowTitle, subtitle, detail] = mapper(row, index); return { id: String(row.id ?? `${table}-${index}`), title: String(rowTitle ?? "Record"), subtitle, detail, search: `${rowTitle} ${subtitle ?? ""} ${detail ?? ""}`.toLowerCase() }; } }; }
function relation(value: any) { const row = Array.isArray(value) ? value[0] : value; return row?.display_name ?? row?.name ?? null; }
function relationValue(value: any, key: string) { const row = Array.isArray(value) ? value[0] : value; return row?.[key] ?? null; }
function number(value: any) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00"; }
function title(value: any) { return String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, backgroundColor: colors.background }, heading: { color: colors.ink, fontSize: 26, fontWeight: "900" }, intro: { marginTop: 6, color: colors.muted }, create: { alignSelf: "flex-start", marginTop: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.pitch }, createText: { color: "white", fontWeight: "900" }, secondary: { alignSelf: "flex-start", marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.pitchSoft }, secondaryText: { color: colors.pitch, fontWeight: "900" }, search: { minHeight: 48, marginTop: 16, marginBottom: 14, paddingHorizontal: 14, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface }, error: { marginBottom: 12, color: colors.danger }, card: { marginBottom: 10, padding: 15, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.surface }, title: { color: colors.ink, fontSize: 16, fontWeight: "900" }, subtitle: { marginTop: 5, color: colors.muted, lineHeight: 19 }, detail: { marginTop: 5, color: colors.pitch, fontSize: 12, fontWeight: "700" }, empty: { padding: 30, color: colors.muted, textAlign: "center" }
});
