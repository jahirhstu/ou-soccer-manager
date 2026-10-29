import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { accessibleWorkspaces, accountLoadError, type AppKind, type MobileContext, type Workspace } from "@ou/contracts";

export type Config = { url: string; publishableKey: string; app: AppKind };
type Value = {
  client: SupabaseClient; session: Session | null; context: MobileContext | null;
  workspace: Workspace | null; workspaces: Workspace[]; busy: boolean; error: string;
  recovery: boolean; finishRecovery(): void; reload(): Promise<void>;
  selectWorkspace(id: string): void; signOut(): Promise<void>;
};
const Context = createContext<Value | null>(null);
export function useMobile() {
  const value = useContext(Context);
  if (!value) throw new Error("MobileProvider is required");
  return value;
}

// Supabase JWTs can exceed a single Keychain item. Publish the manifest last.
function secureStorage(prefix: string) {
  async function removeVersion(key: string, manifest: string | null) {
    if (!manifest) return;
    const { version, count } = JSON.parse(manifest) as { version: string; count: number };
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${prefix}.${key}.${version}.${i}`);
  }
  return {
    async getItem(key: string) {
      const manifest = await SecureStore.getItemAsync(`${prefix}.${key}`);
      if (!manifest) return null;
      const { version, count } = JSON.parse(manifest) as { version: string; count: number };
      const chunks: string[] = [];
      for (let i = 0; i < count; i++) {
        const chunk = await SecureStore.getItemAsync(`${prefix}.${key}.${version}.${i}`);
        if (chunk === null) return null;
        chunks.push(chunk);
      }
      return chunks.join("");
    },
    async setItem(key: string, value: string) {
      const old = await SecureStore.getItemAsync(`${prefix}.${key}`);
      const version = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const count = Math.ceil(value.length / 400);
      for (let i = 0; i < count; i++)
        await SecureStore.setItemAsync(`${prefix}.${key}.${version}.${i}`, value.slice(i * 400, (i + 1) * 400));
      await SecureStore.setItemAsync(`${prefix}.${key}`, JSON.stringify({ version, count }));
      await removeVersion(key, old);
    },
    async removeItem(key: string) {
      const old = await SecureStore.getItemAsync(`${prefix}.${key}`);
      await SecureStore.deleteItemAsync(`${prefix}.${key}`);
      await removeVersion(key, old);
    }
  };
}

export function MobileProvider({ config, children }: { config: Config; children: ReactNode }) {
  const [client] = useState(() => createClient(config.url, config.publishableKey, {
    auth: { storage: secureStorage(config.app), storageKey: `ou-${config.app}-auth`,
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" }
  }));
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<MobileContext | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async (quiet = false) => {
    const current = ++generation.current;
    if (!quiet) { setBusy(true); setContext(null); }
    setError("");
    try {
      const { data: auth, error: authError } = await client.auth.getSession();
      if (authError) throw authError;
      if (current !== generation.current) return;
      setSession(auth.session);
      if (auth.session) {
        const { data, error: rpcError } = await client.rpc("mobile_context");
        if (rpcError) throw rpcError;
        if (current === generation.current) setContext(data as MobileContext);
      }
    } catch (cause) {
      if (current === generation.current) { setContext(null); setError(accountLoadError(cause)); }
    } finally { if (current === generation.current) setBusy(false); }
  }, [client]);
  useEffect(() => {
    void reload();
    const { data: listener } = client.auth.onAuthStateChange((event, next) => {
      if (event === "SIGNED_OUT") {
        generation.current++; setContext(null); setSelected(null); setRecovery(false);
        setSession(null); setBusy(false);
      } else if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") {
        setSession(next);
        if (event === "PASSWORD_RECOVERY") setRecovery(true);
        // Do not invoke Supabase from within its auth lock.
        setTimeout(() => void reload(), 0);
      }
    });
    const appState = AppState.addEventListener("change", (state) => {
      // Native pickers temporarily background the app. Keep their owning screen mounted.
      // Memberships are revalidated on return; the server still authorizes every operation.
      if (state === "active") { client.auth.startAutoRefresh(); void reload(true); }
      else { client.auth.stopAutoRefresh(); }
    });
    async function acceptLink(url: string) {
      if (!url.startsWith(`ou-${config.app}://auth/`)) return;
      const parsed = Linking.parse(url);
      const code = parsed.queryParams?.code;
      if (typeof code !== "string") return;
      const { error: linkError } = await client.auth.exchangeCodeForSession(code);
      if (linkError) setError("This link expired or was opened on a different device. Request another email.");
      else if (url.startsWith(`ou-${config.app}://auth/recovery`)) setRecovery(true);
    }
    void Linking.getInitialURL().then((url) => { if (url) void acceptLink(url); });
    const links = Linking.addEventListener("url", ({ url }) => void acceptLink(url));
    return () => { generation.current++; listener.subscription.unsubscribe(); appState.remove(); links.remove(); client.auth.stopAutoRefresh(); };
  }, [client, config.app, reload]);
  const workspaces = context ? accessibleWorkspaces(context, config.app) : [];
  const workspace = workspaces.find((item) => item.programId === selected) ?? workspaces[0] ?? null;
  return <Context.Provider value={{
    client, session, context, workspace, workspaces, busy, error, recovery,
    finishRecovery: () => setRecovery(false), reload,
    selectWorkspace: (id) => { setSelected(id); },
    signOut: async () => {
      generation.current++; setContext(null); setSelected(null); setRecovery(false);
      const { error: signOutError } = await client.auth.signOut({ scope: "local" });
      if (signOutError) { setError(signOutError.message); throw signOutError; }
      setSession(null);
    }
  }}>{children}</Context.Provider>;
}
