import { useState, type ReactNode } from "react";
import { Alert, Text, View } from "react-native";
import { accountLoadError, type AppKind } from "@ou/contracts";
import { Badge, Busy, Button, Field, Row, Screen, Section, colors, styles } from "@ou/mobile-ui";
import { useMobile } from "./provider";

export function AccountGate({ app, children }: { app: AppKind; children: ReactNode }) {
  const { session, busy, error, reload, recovery, workspace, signOut } = useMobile();
  if (busy) return <Busy />;
  if (recovery) return <Recovery />;
  if (!session) return <Login app={app} />;
  if (error) return <Screen title="Unable to load account"><Text style={styles.error}>{error}</Text><Button onPress={() => void reload()}>Retry</Button><Button secondary onPress={() => void signOut().catch(() => {})}>Sign out</Button></Screen>;
  if (!workspace) return <Approval app={app} />;
  return <>{children}</>;
}

function Login({ app }: { app: AppKind }) {
  const { client } = useMobile();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [program, setProgram] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (pending) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Enter your full email address."); return; }
    if (mode === "signup" && (!name.trim() || !organization.trim())) { setError("Name and organization are required."); return; }
    setPending(true); setError("");
    try {
      if (mode === "reset") {
        const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `ou-${app}://auth/recovery` });
        if (result.error) throw result.error;
        Alert.alert("Check your email", "Open the password recovery link on this device.");
      } else if (mode === "signup") {
        const result = await client.auth.signUp({ email: email.trim(), password, options: {
          emailRedirectTo: `ou-${app}://auth/confirm`,
          data: { display_name: name.trim(), organization_slug: organization.trim(), program_slug: program.trim() || undefined }
        } });
        if (result.error) throw result.error;
        if (!result.data.session) Alert.alert("Check your email", "Confirm your email, then sign in. Membership requires approval.");
      } else {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
      }
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { setPending(false); }
  }
  return <Screen title={mode === "signup" ? "Create account" : mode === "reset" ? "Reset password" : app === "participant" ? "OU Sports" : "OU Manager"}>
    <View style={{ paddingVertical: 18, gap: 8 }}><View style={{ backgroundColor: colors.forest, width: 52, height: 52, borderRadius: 8, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white", fontSize: 22, fontWeight: "800" }}>OU</Text></View><Text style={styles.heading}>{mode === "login" ? "Welcome back" : mode === "signup" ? "Your player account" : "Recover your account"}</Text></View>
    <Section>ACCOUNT DETAILS</Section>
    <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
    {mode !== "reset" ? <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={mode === "signup" ? "new-password" : "current-password"} /> : null}
    {mode === "signup" ? <>
      <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
      <Section>MEMBERSHIP REQUEST</Section>
      <Field label="Organization slug" value={organization} onChangeText={setOrganization} autoCapitalize="none" />
      <Field label="Program slug (optional)" value={program} onChangeText={setProgram} autoCapitalize="none" />
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button disabled={pending} onPress={() => void submit()}>{pending ? "Please wait..." : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send recovery email"}</Button>
    <Button secondary disabled={pending} onPress={() => { setMode(mode === "reset" ? "login" : "reset"); setError(""); }}>{mode === "reset" ? "Back to sign in" : "Forgot password"}</Button>
    {app === "participant" ? <Button secondary disabled={pending} onPress={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}>{mode === "signup" ? "Back to sign in" : "Create account"}</Button> : null}
  </Screen>;
}

function Recovery() {
  const { client, finishRecovery } = useMobile();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (pending) return;
    if (password.length < 8 || password !== confirm) { setError("Use at least eight characters and matching passwords."); return; }
    setPending(true);
    const { error: saveError } = await client.auth.updateUser({ password });
    setPending(false);
    if (saveError) setError(saveError.message); else finishRecovery();
  }
  return <Screen title="New password">
    <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
    <Field label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Button disabled={pending} onPress={() => void save()}>Save password</Button>
  </Screen>;
}

function Approval({ app }: { app: AppKind }) {
  const { client, context, reload, signOut } = useMobile();
  const [organization, setOrganization] = useState("");
  const [program, setProgram] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function request() {
    setPending(true);
    try {
      const result = await client.rpc("request_membership_for_slug", { p_organization_slug: organization.trim(), p_program_slug: program.trim() || null });
      if (result.error) throw result.error;
      Alert.alert("Request submitted", "An administrator must approve your membership.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setPending(false); }
  }
  return <Screen title="Membership">
    {context?.requests?.map((request, index) => <View key={index} style={styles.card}><Text style={styles.title}>{request.name}</Text><Badge label={request.status} /></View>)}
    <Text style={styles.body}>{app === "management" ? "An active organization or program manager membership is required." : "Your account has no active program membership. An administrator can approve your request and link your player record."}</Text>
    {app === "participant" ? <>
      <Field label="Organization slug" value={organization} onChangeText={setOrganization} autoCapitalize="none" />
      <Field label="Program slug (optional)" value={program} onChangeText={setProgram} autoCapitalize="none" />
      <Button disabled={pending || !organization.trim()} onPress={() => void request()}>Request membership</Button>
    </> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Button onPress={() => void reload()}>Refresh membership</Button>
    <Button secondary onPress={() => void signOut().catch(() => {})}>Sign out</Button>
  </Screen>;
}

export function WorkspaceMenu() {
  const { workspace, workspaces, selectWorkspace, signOut } = useMobile();
  const [open, setOpen] = useState(false);
  return <View>
    <Row title={workspace?.programName ?? "Program"} subtitle={workspace?.organizationName} onPress={() => setOpen(!open)} />
    {open ? <View>
      {workspaces.map((item) => <Row key={item.programId} title={item.programName} subtitle={item.organizationName} onPress={() => { selectWorkspace(item.programId); setOpen(false); }} />)}
      <Button secondary onPress={() => void signOut().catch(() => {})}>Sign out</Button>
    </View> : null}
  </View>;
}
