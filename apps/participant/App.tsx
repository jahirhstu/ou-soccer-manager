import { useEffect, useState } from "react";
import { Alert, Image, Text, View } from "react-native";
import { CalendarDays, Wallet, UserRound, Camera, ImagePlus } from "lucide-react-native";
import { File } from "expo-file-system";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { AccountGate, MobileProvider, ProgramContext, RecordPreview, Records, saveProfilePhoto, useMobile, WorkspaceMenu } from "@ou/mobile-core";
import { MatchDay, SessionOperations } from "@ou/match-day";
import { accountLoadError, type Resource } from "@ou/contracts";
import { Avatar, Badge, BottomTabs, Button, Columns, Row, Screen, Section, Segments, Shortcuts, colors, styles, type TabItem } from "@ou/mobile-ui";

const config = {
  app: "participant" as const,
  url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
};
export default function App() {
  return <SafeAreaProvider><SafeAreaView style={styles.screen}><StatusBar style="dark" />
    {!config.url || !config.publishableKey ? <Screen title="App setup required"><Text style={styles.body}>Configure the development Supabase URL and publishable key.</Text></Screen> :
      <MobileProvider config={config}><AccountGate app="participant"><Participant /></AccountGate></MobileProvider>}
  </SafeAreaView></SafeAreaProvider>;
}
function Participant() {
  const { workspace } = useMobile();
  return <ParticipantWorkspace key={workspace!.programId} />;
}
function ParticipantWorkspace() {
  const { context, workspace } = useMobile();
  const [tab, setTab] = useState<TabItem["key"]>("home");
  const [sessions, setSessions] = useState("upcomingSessions");
  const [statistics, setStatistics] = useState("myStatistics");
  const [finance, setFinance] = useState("myBalances");
  const [session, setSession] = useState<string | null>(null);
  const [operations, setOperations] = useState(false);
  const items: TabItem[] = [{ key: "home", label: "Home" },
    ...(workspace!.modules.activities !== false ? [{ key: "sessions" as const, label: "Sessions" }] : []),
    ...(workspace!.modules.scores !== false ? [{ key: "statistics" as const, label: "Statistics" }] : []),
    ...(workspace!.modules.payments !== false ? [{ key: "finances" as const, label: "Finances" }] : []), { key: "account", label: "Account" }];
  const active = items.some((item) => item.key === tab) ? tab : "home";
  const selectSession = workspace!.modules.scores !== false && workspace!.modules.teams !== false ? setSession : undefined;
  if (operations) return <View style={styles.screen}><ProgramContext /><SessionOperations onBack={() => setOperations(false)} /></View>;
  if (session) return <View style={styles.screen}><ProgramContext /><MatchDay sessionId={session} onBack={() => setSession(null)} /></View>;
  let content;
  if (active === "account") content = <Profile onOperations={() => setOperations(true)} />;
  else if (active === "sessions") content = <Records key={sessions} resource={sessions as Resource} title="Sessions" onSelect={selectSession}
    header={<Segments options={[{ value: "upcomingSessions", label: "Upcoming" }, { value: "sessions", label: "All" }, { value: "mySessions", label: "Played" }]} value={sessions} onChange={setSessions} />} />;
  else if (active === "statistics") content = <Records key={statistics} resource={statistics as Resource} title="Statistics"
    header={<Segments options={[{ value: "myStatistics", label: "My statistics" }, { value: "statistics", label: "Program leaders" }]} value={statistics} onChange={setStatistics} />} />;
  else if (active === "finances") content = <Records key={finance} resource={finance as Resource} title="My finances"
    header={<Segments options={[{ value: "myBalances", label: "Season balances" }, { value: "myPayments", label: "Transactions" }]} value={finance} onChange={setFinance} />} />;
  else content = <Screen title="OU Sports">
    <View style={styles.horizontal}><Avatar name={context?.profile?.displayName||"Player"} size={44}/><View style={{flex:1,gap:2}}><Text style={styles.muted}>YOUR MATCH DAY</Text><Text style={styles.heading}>Hi, {context?.profile?.displayName || "player"}</Text></View></View>
    {!workspace?.playerId ? <Text style={styles.muted}>Your account is not linked to a player yet. Ask your administrator to link the correct player record.</Text> : null}
    {workspace!.modules.activities !== false ? <RecordPreview resource="upcomingSessions" title="NEXT SESSION" onSelect={selectSession} /> : null}
    <Shortcuts items={items.filter((item) => item.key === "sessions" || item.key === "finances").map((item) => ({ title: item.label, icon: item.key === "sessions" ? CalendarDays : Wallet, onPress: () => setTab(item.key) }))} />
    {workspace!.modules.scores !== false ? <RecordPreview resource="myStatistics" title="MY PERFORMANCE" /> : null}
    {workspace!.modules.activities !== false ? <RecordPreview resource="mySessions" title="LAST PLAYED SESSION" onSelect={selectSession} /> : null}
  </Screen>;
  return <View style={styles.screen}><ProgramContext /><View style={{ flex: 1 }}>{content}</View><BottomTabs items={items} value={active} onChange={setTab} /></View>;
}
function Profile({ onBack, onOperations }: { onBack?: () => void; onOperations?: () => void }) {
  const { client, context, reload, workspace, signOut } = useMobile();
  const [pending, setPending] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (context?.profile.photoPath) void client.storage.from("profile-photos").createSignedUrl(context.profile.photoPath, 300).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError(loadError.message); else setPhoto(data.signedUrl);
    });
    return () => { active = false; };
  }, [client, context?.profile.photoPath]);
  async function viewPhoto() {
    if (!context?.profile.photoPath) return;
    const result = await client.storage.from("profile-photos").createSignedUrl(context.profile.photoPath, 300);
    if (result.error) setError(result.error.message); else setPhoto(result.data.signedUrl);
  }
  async function choose(camera: boolean) {
    if (pending || !context?.profile) return;
    setPending(true); setError("");
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { Alert.alert("Permission needed", "Enable photo access in your device settings."); return; }
      const result = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (result.canceled) return;
      const compressed = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 640 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
      const bytes = await new File(compressed.uri).arrayBuffer();
      await saveProfilePhoto(client, context.profile.id, bytes, context.profile.photoPath);
      setPhoto(compressed.uri);
      Alert.alert("Photo saved", "Your profile photo has been updated.");
      await reload();
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { setPending(false); }
  }
  return <Screen title="My profile" onBack={onBack}>
    <View style={styles.horizontal}>
      {photo ? <Image accessibilityLabel="Your profile photo" source={{ uri: photo }} onError={() => setError("Photo could not load. Tap View photo to refresh.")} style={{ width: 80, height: 80, borderRadius: 40 }} /> : <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" }}><UserRound size={36} color={colors.green} /></View>}
      <View style={{ flex: 1, gap: 4 }}><Text style={styles.title}>{context?.profile.displayName}</Text><Text style={styles.muted}>{context?.profile.email}</Text></View>
    </View>
    <Section>PROFILE PHOTO</Section>
    {context?.profile.photoPath ? <Button secondary onPress={() => void viewPhoto()}>View photo</Button> : null}
    <Columns><Button icon={<ImagePlus size={20} color="white" />} disabled={pending} onPress={() => void choose(false)}>{pending ? "Saving photo..." : "Choose photo"}</Button>
    <Button icon={<Camera size={20} color={colors.ink} />} secondary disabled={pending} onPress={() => void choose(true)}>Take photo</Button>
    </Columns>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Section>MEMBERSHIP</Section>
    <WorkspaceMenu />
    <Badge label={workspace?.role ?? "member"} />
    <Text style={styles.muted}>Active program membership</Text>
    {onOperations && workspace && ["manager", "captain"].includes(workspace.role) && workspace.modules.activities !== false && workspace.modules.attendance !== false ? <Button secondary onPress={onOperations}>Session attendance</Button> : null}
    <Button secondary disabled={pending} onPress={() => Alert.alert("Sign out?", "You can sign in again with your existing account.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", onPress: () => void signOut().catch(() => {}) }])}>Sign out</Button>
  </Screen>;
}
