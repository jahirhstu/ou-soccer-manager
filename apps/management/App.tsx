import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { CalendarDays, Users, Wallet, Trophy, ReceiptText } from "lucide-react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AccountGate, MobileProvider, ProgramContext, RecordPreview, Records, useMobile, WorkspaceMenu } from "@ou/mobile-core";
import { resourceModule, type Resource } from "@ou/contracts";
import { MatchDay, SessionOperations } from "@ou/match-day";
import { Badge, BottomTabs, Button, Row, Screen, Section, Shortcuts, styles, type TabItem } from "@ou/mobile-ui";
import { Finance } from "./src/Finance";
import { CreateRecord, type CreateKind } from "./src/CreateRecord";
import { Member } from "./src/Member";
import { WhatsappImport } from "./src/WhatsappImport";

const config = { app: "management" as const, url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "", publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" };
export default function App() {
  return <SafeAreaProvider><SafeAreaView style={styles.screen}><StatusBar style="dark" />
    {!config.url || !config.publishableKey ? <Screen title="App setup required"><Text style={styles.body}>Configure the development Supabase URL and publishable key.</Text></Screen> :
      <MobileProvider config={config}><AccountGate app="management"><Management /></AccountGate></MobileProvider>}
  </SafeAreaView></SafeAreaProvider>;
}
function Management() {
  const { workspace } = useMobile();
  return <ManagementWorkspace key={workspace!.programId} />;
}
function ManagementWorkspace() {
  const { workspace, context, signOut } = useMobile();
  const [tab, setTab] = useState<TabItem["key"]>("home");
  const [screen, setScreen] = useState<Resource | "home" | "finance">("home");
  const [session, setSession] = useState<string | null>(null);
  const [create, setCreate] = useState<CreateKind | null>(null);
  const [member, setMember] = useState<string | null>(null);
  const [operations, setOperations] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [performance, setPerformance] = useState(false);
  const wrap = (content: React.ReactNode) => <View style={styles.screen}><ProgramContext />{content}</View>;
  if (performance) return wrap(<PerformanceHub onBack={() => setPerformance(false)} />);
  if (whatsapp) return wrap(<WhatsappImport onBack={() => setWhatsapp(false)} />);
  if (operations) return wrap(<SessionOperations onBack={() => setOperations(false)} />);
  if (member) return wrap(<Member id={member} onBack={() => setMember(null)} />);
  if (create) return wrap(<CreateRecord kind={create} onBack={() => setCreate(null)} />);
  if (session) return wrap(<MatchDay sessionId={session} onBack={() => setSession(null)} />);
  if (screen === "finance") return wrap(<Finance onBack={() => setScreen("home")} />);
  const items: TabItem[] = [{ key: "home", label: "Dashboard" }, { key: "program", label: "Program" },
    ...(workspace!.modules.members !== false ? [{ key: "members" as const, label: "Members" }] : []),
    ...(workspace!.modules.payments !== false || workspace!.modules.expenses !== false ? [{ key: "finances" as const, label: "Finance" }] : []), { key: "more", label: "More" }];
  const active = items.some((item) => item.key === tab) ? tab : "home";
  const selectSession = workspace!.modules.scores !== false && workspace!.modules.teams !== false ? setSession : undefined;
  const resource = screen !== "home" ? screen : active === "members" ? "members" : null;
  let content;
  if (resource) content = <Records key={resource} resource={resource} title={labels[resource] ?? resource} onBack={screen !== "home" ? () => setScreen("home") : undefined} onSelect={resource === "sessions" ? selectSession : resource === "members" ? setMember : undefined}
    header={resource === "sessions" || resource === "seasons" || resource === "players" ? <Button onPress={() => setCreate(resource === "sessions" ? "session" : resource === "seasons" ? "season" : "player")}>Add {resource === "sessions" ? "session" : resource === "seasons" ? "season" : "player"}</Button> : null} />;
  else if (active === "more") content = <Screen title="Account and program"><Text style={styles.title}>{context?.profile?.displayName}</Text><Text style={styles.muted}>{context?.profile?.email}</Text><WorkspaceMenu /><Section>YOUR ACCESS</Section><Badge label={workspace!.role} /><Row title="Organization role" detail={workspace!.organizationRole ?? "Member"} /><Button secondary onPress={() => Alert.alert("Sign out?", "You can sign in again with your existing account.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", onPress: () => void signOut().catch(() => {}) }])}>Sign out</Button></Screen>;
  else {
    const resources: Resource[] = active === "finances" ? ["balances", "payments", "expenses"] : active === "program" ? ["sessions", "seasons", "players", "statistics"] : ["sessions", "members", "balances", "statistics"];
    content = <Screen title={active === "home" ? "OU Manager" : active === "finances" ? "Finance" : "Program"}>
      {active === "home" ? <><Text style={styles.heading}>{workspace!.programName}</Text><Badge label={workspace!.role} />{workspace!.modules.activities !== false ? <RecordPreview resource="upcomingSessions" title="NEXT SESSION" onSelect={selectSession} /> : null}</> : null}
      <Section>{active === "finances" ? "FINANCIAL RECORDS" : "PROGRAM ACCESS"}</Section>
      {active !== "finances" && workspace!.modules.scores !== false ? <Button secondary onPress={() => setPerformance(true)}>Position leaderboards & match ratings</Button> : null}
      {active === "program" && workspace!.role === "manager" && workspace!.modules.whatsapp_import !== false ? <Button secondary onPress={() => setWhatsapp(true)}>WhatsApp import</Button> : null}
      {active === "program" && workspace!.modules.activities !== false && workspace!.modules.attendance !== false ? <Button secondary onPress={() => setOperations(true)}>Attendance and completion</Button> : null}
      <Shortcuts items={resources.filter((entry) => workspace!.modules[resourceModule(entry)] !== false).map((entry) => ({ title: labels[entry] ?? entry, icon: entry === "sessions" || entry === "seasons" ? CalendarDays : entry === "members" || entry === "players" ? Users : entry === "statistics" ? Trophy : entry === "balances" ? Wallet : ReceiptText, onPress: () => setScreen(entry) }))} />
      {(active === "finances" || active === "home") && (workspace!.modules.payments !== false || workspace!.modules.expenses !== false) ? <Button onPress={() => setScreen("finance")}>Record transaction</Button> : null}
      {active === "program" && workspace!.modules.activities !== false ? <RecordPreview resource="seasons" title="MOST RECENT SEASON" /> : null}
    </Screen>;
  }
  return <View style={styles.screen}><ProgramContext /><View style={{ flex: 1 }}>{content}</View><BottomTabs items={items} value={active} onChange={(value) => { setTab(value); setScreen("home"); }} /></View>;
}
const labels: Partial<Record<Resource, string>> = { sessions: "Sessions", seasons: "Seasons", players: "Players", members: "Members", balances: "Player balances", payments: "Transactions", expenses: "Expenses", statistics: "Scorers and assists" };
import { PerformanceHub } from "@ou/match-day";
