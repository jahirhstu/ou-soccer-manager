import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import type { MobileOrganization, MobileProfile, MobileProgram, UserRole } from "../types";

const organizationStorageKey = "ou-soccer.active-organization";
const programStorageKeyPrefix = "ou-soccer.active-program.";

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  profile: MobileProfile | null;
  organizations: MobileOrganization[];
  programs: MobileProgram[];
  activeProgram: MobileProgram | null;
  error: string | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  selectOrganization(organizationId: string): Promise<void>;
  selectProgram(programId: string | null): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [baseProfile, setBaseProfile] = useState<any>(null);
  const [organizations, setOrganizations] = useState<MobileOrganization[]>([]);
  const [programs, setPrograms] = useState<MobileProgram[]>([]);
  const [activeProgram, setActiveProgram] = useState<MobileProgram | null>(null);
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
          setBaseProfile(null);
          setOrganizations([]);
          setPrograms([]);
          setActiveProgram(null);
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
      const { data: memberships, error: membershipError } = await supabase
        .from("organization_members")
        .select("organization_id,role,player_id,organizations(name,slug)")
        .eq("profile_id", session.user.id)
        .order("created_at");
      if (membershipError || !memberships?.length) {
        if (active) {
          setError(membershipError?.message ?? "No organization membership was found.");
          setLoading(false);
        }
        return;
      }
      const availableOrganizations = memberships.flatMap((membership: any) => {
        const organization = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
        if (!membership.organization_id || !organization) return [];
        const role: UserRole = baseProfile.role === "admin"
          ? "admin"
          : membership.role === "owner"
            ? "admin"
            : (membership.role ?? baseProfile.role) as UserRole;
        return [{ id: membership.organization_id, name: organization.name, slug: organization.slug, role, playerId: membership.player_id ?? baseProfile.player_id }];
      });
      const storedOrganizationId = await AsyncStorage.getItem(organizationStorageKey);
      const selectedOrganization = availableOrganizations.find((item: MobileOrganization) => item.id === storedOrganizationId) ?? availableOrganizations[0];
      if (!selectedOrganization) {
        if (active) {
          setError("No accessible organization was found.");
          setLoading(false);
        }
        return;
      }
      if (active) {
        setBaseProfile(baseProfile);
        setOrganizations(availableOrganizations);
        await activateOrganization(baseProfile, selectedOrganization, active);
      }
    }
    void loadProfile();
    return () => { active = false; };
  }, [session]);

  async function activateOrganization(profileData: any, organization: MobileOrganization, isActive = true) {
    await AsyncStorage.setItem(organizationStorageKey, organization.id);
    const { data: programRows, error: programError } = await supabase
      .from("programs")
      .select("id,name,slug,category")
      .eq("organization_id", organization.id)
      .order("name");
    if (!isActive) return;
    if (programError) {
      setError(programError.message);
      setLoading(false);
      return;
    }
    const availablePrograms = (programRows ?? []) as MobileProgram[];
    const storedProgramId = await AsyncStorage.getItem(`${programStorageKeyPrefix}${organization.id}`);
    const selectedProgram = availablePrograms.find((item) => item.id === storedProgramId) ?? availablePrograms[0] ?? null;
    setProfile({
      id: profileData.id,
      displayName: profileData.display_name,
      email: profileData.email,
      role: organization.role,
      playerId: organization.playerId,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationSlug: organization.slug
    });
    setPrograms(availablePrograms);
    setActiveProgram(selectedProgram);
    setLoading(false);
  }

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    session,
    profile,
    organizations,
    programs,
    activeProgram,
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
    },
    async selectOrganization(organizationId) {
      const organization = organizations.find((item) => item.id === organizationId);
      if (!organization || !baseProfile) return;
      setLoading(true);
      setError(null);
      await activateOrganization(baseProfile, organization);
    },
    async selectProgram(programId) {
      const program = programs.find((item) => item.id === programId) ?? null;
      if (programId && !program) return;
      if (profile) {
        const storageKey = `${programStorageKeyPrefix}${profile.organizationId}`;
        if (program) await AsyncStorage.setItem(storageKey, program.id);
        else await AsyncStorage.removeItem(storageKey);
      }
      setActiveProgram(program);
    }
  }), [activeProgram, baseProfile, error, loading, organizations, profile, programs, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
