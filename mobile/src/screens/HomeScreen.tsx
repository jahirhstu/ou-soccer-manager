import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth/AuthProvider";
import { WorkspaceSwitcher } from "../components/WorkspaceSwitcher";
import { canWriteFeature, type Feature, visibleFeatures } from "../features";
import { colors } from "../theme";
import type { RootStackParamList } from "../navigation/types";

export function HomeScreen() {
  const { profile, activeProgram, signOut } = useAuth();
  const [group, setGroup] = useState<Feature["group"] | null>(null);
  const [workspaceVisible, setWorkspaceVisible] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (!profile) return null;
  const available = visibleFeatures(profile.role);
  const data = group ? available.filter((feature) => feature.group === group) : available;

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={data}
      keyExtractor={(item) => item.key}
      ListHeaderComponent={
        <View>
          <WorkspaceSwitcher onClose={() => setWorkspaceVisible(false)} visible={workspaceVisible} />
          <View style={styles.header}>
            <View style={styles.logo}><Text style={styles.logoText}>OU</Text></View>
            <View style={styles.identity}>
              <Text numberOfLines={1} style={styles.name}>{profile.displayName}</Text>
              <Text numberOfLines={1} style={styles.organization}>{profile.organizationName} · {activeProgram?.name ?? "No program"} · {profile.role}</Text>
            </View>
            <Pressable onPress={() => setWorkspaceVisible(true)}><Text style={styles.signOut}>Switch</Text></Pressable>
          </View>
          <Pressable onPress={() => void signOut()} style={styles.signOutButton}><Text style={styles.signOut}>Sign out</Text></Pressable>
          <Text style={styles.heading}>Your workspace</Text>
          <Text style={styles.intro}>The options below match your web access. Database policies enforce the same permissions.</Text>
          <View style={styles.filters}>
            {[null, "Club", "Admin", "Reports"].map((item) => (
              <Pressable key={item ?? "all"} onPress={() => setGroup(item as Feature["group"] | null)} style={[styles.filter, group === item && styles.filterActive]}>
                <Text style={[styles.filterText, group === item && styles.filterTextActive]}>{item ?? "All"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      }
      renderItem={({ item }) => {
        const writable = canWriteFeature(profile.role, item.key);
        return (
          <Pressable onPress={() => {
            if (item.key === "sessions") navigation.navigate("Sessions");
            else if (item.key === "attendance") navigation.navigate("Attendance");
            else if (item.key === "notifications") navigation.navigate("Notifications");
            else if (item.key === "users") navigation.navigate("Users");
            else if (item.key === "settings") navigation.navigate("Settings");
            else if (item.key === "performance") navigation.navigate("Performance");
            else if (item.key === "leagues") navigation.navigate("Leagues");
            else if (item.key === "whatsapp") navigation.navigate("WhatsAppImport");
            else if (item.key === "reminders") navigation.navigate("Reminders");
            else if (item.key === "myStatus") navigation.navigate("MyStatus");
            else navigation.navigate("Feature", { featureKey: item.key });
          }} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardDescription}>{item.description}</Text>
            </View>
            <Text style={[styles.badge, writable ? styles.writeBadge : styles.readBadge]}>{writable ? "Write" : "View"}</Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 40, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 28 },
  logo: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.pitch },
  logoText: { color: "white", fontWeight: "900" },
  identity: { flex: 1 },
  name: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  organization: { marginTop: 3, color: colors.muted, fontSize: 12, textTransform: "capitalize" },
  signOut: { color: colors.pitch, fontWeight: "700" },
  signOutButton: { alignSelf: "flex-end", marginTop: -18, marginBottom: 16 },
  heading: { color: colors.ink, fontSize: 26, fontWeight: "900" },
  intro: { marginTop: 7, marginBottom: 18, color: colors.muted, lineHeight: 21 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  filter: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  filterActive: { borderColor: colors.pitch, backgroundColor: colors.pitch },
  filterText: { color: colors.muted, fontWeight: "700" },
  filterTextActive: { color: "white" },
  card: { minHeight: 78, marginBottom: 10, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardText: { flex: 1 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  cardDescription: { marginTop: 4, color: colors.muted },
  badge: { overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, fontSize: 11, fontWeight: "800" },
  writeBadge: { color: colors.pitch, backgroundColor: colors.pitchSoft },
  readBadge: { color: colors.muted, backgroundColor: "#F1F5F9" },
  pressed: { opacity: 0.7 }
});
