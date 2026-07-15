import { useCallback, useLayoutEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../auth/AuthProvider";
import { LoadingView } from "../components/LoadingView";
import { supabase } from "../lib/supabase";
import { colors } from "../theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Sessions">;
type SessionRow = { id: string; name: string | null; session_date: string; status: string; location: string | null; price_per_session: number | null; seasons: any; playgrounds: any };

export function SessionsScreen({ navigation }: Props) {
  const { profile, activeProgram } = useAuth();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    navigation.setOptions(profile?.role === "admin" ? { headerRight: () => <Pressable onPress={() => navigation.navigate("CreateRecord", { featureKey: "sessions" })}><Text style={styles.add}>Add</Text></Pressable> } : { headerRight: undefined });
  }, [navigation, profile?.role]);

  const load = useCallback(async (refresh = false) => {
    if (!profile) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    let query = supabase.from("sessions").select("id,name,session_date,status,location,price_per_session,seasons(name),playgrounds(name)").eq("organization_id", profile.organizationId).order("session_date", { ascending: false });
    if (activeProgram?.id) query = query.eq("program_id", activeProgram.id);
    const { data, error: queryError } = await query;
    if (queryError) setError(queryError.message);
    else setRows((data ?? []) as SessionRow[]);
    setLoading(false);
    setRefreshing(false);
  }, [activeProgram?.id, profile]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (loading) return <LoadingView error={error} />;
  return <FlatList contentContainerStyle={styles.content} data={rows} keyExtractor={(item) => item.id} refreshControl={<RefreshControl onRefresh={() => void load(true)} refreshing={refreshing} tintColor={colors.pitch} />} ListEmptyComponent={<Text style={styles.empty}>{error ?? "No sessions found."}</Text>} renderItem={({ item }) => {
    const field = relationName(item.playgrounds) ?? item.location ?? "No field";
    return <Pressable onPress={() => navigation.navigate("SessionDetail", { sessionId: item.id })} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.row}><Text style={styles.date}>{item.session_date}</Text><Text style={[styles.status, statusStyle(item.status)]}>{item.status}</Text></View>
      <Text style={styles.title}>{item.name ?? "Soccer session"}</Text>
      <Text style={styles.meta}>{relationName(item.seasons) ?? "No season"} · {field}</Text>
    </Pressable>;
  }} />;
}

function relationName(value: any) { const row = Array.isArray(value) ? value[0] : value; return row?.name ?? null; }
function statusStyle(status: string) { return status === "completed" ? styles.completed : status === "cancelled" ? styles.cancelled : styles.scheduled; }
const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 36, backgroundColor: colors.background },
  card: { marginBottom: 10, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  date: { color: colors.pitch, fontWeight: "800" },
  title: { marginTop: 9, color: colors.ink, fontSize: 17, fontWeight: "900" },
  meta: { marginTop: 5, color: colors.muted },
  status: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  scheduled: { color: "#1D4ED8", backgroundColor: "#DBEAFE" }, completed: { color: colors.pitch, backgroundColor: colors.pitchSoft }, cancelled: { color: colors.danger, backgroundColor: "#FFE4E6" },
  empty: { padding: 30, color: colors.muted, textAlign: "center" }, pressed: { opacity: 0.7 }
  ,add: { color: colors.pitch, fontWeight: "900" }
});
