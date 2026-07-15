import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { supabase } from "../lib/supabase";
import type { MobileProfile, UserRole } from "../types";

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  profile: MobileProfile | null;
  error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      if (!session?.user) {
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      const { data: baseProfile, error: profileError } = await supabase
        .from("profiles")
        .select("id,display_name,email,role,player_id")
        .eq("id", session.user.id)
        .maybeSingle();
      if (profileError || !baseProfile) {
        if (active) {
          setError(profileError?.message ?? "Your profile could not be loaded.");
          setLoading(false);
        }
        return;
      }
      const { data: membership, error: membershipError } = await supabase
        .from("organization_members")
        .select("organization_id,role,player_id,organizations(name,slug)")
        .eq("profile_id", session.user.id)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      const organization = Array.isArray(membership?.organizations)
        ? membership.organizations[0]
        : membership?.organizations;
      if (membershipError || !membership?.organization_id || !organization) {
        if (active) {
          setError(membershipError?.message ?? "No organization membership was found.");
          setLoading(false);
        }
        return;
      }
      const role: UserRole = baseProfile.role === "admin"
        ? "admin"
        : membership.role === "owner"
          ? "admin"
          : (membership.role ?? baseProfile.role) as UserRole;
      if (active) {
        setProfile({
          id: baseProfile.id,
          displayName: baseProfile.display_name,
          email: baseProfile.email,
          role,
          playerId: membership.player_id ?? baseProfile.player_id,
          organizationId: membership.organization_id,
          organizationName: organization.name,
          organizationSlug: organization.slug
        });
        setLoading(false);
      }
    }
    void loadProfile();
    return () => { active = false; };
  }, [session]);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    session,
    profile,
    error,
    async signIn(email, password) {
      setError(null);
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        setError(signInError.message);
        throw signInError;
      }
    },
    async signOut() {
      setError(null);
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) setError(signOutError.message);
    }
  }), [error, loading, profile, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
