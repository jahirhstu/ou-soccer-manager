"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";

export async function loginAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const email = buildOuSoccerEmail(formData);
  if (!email) redirect("/login?error=Enter%20a%20valid%20name.");
  const password = String(formData.get("password"));
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (profile?.role === "captain") redirect("/sessions");
  }
  redirect("/dashboard");
}

export async function signupAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const email = buildOuSoccerEmail(formData);
  if (!email) redirect("/signup?error=Enter%20a%20valid%20email%20name.");
  const password = String(formData.get("password"));
  const displayName = String(formData.get("displayName"));
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

function buildOuSoccerEmail(formData: FormData) {
  const name = String(formData.get("emailName") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(name)) return "";
  return `${name}@ou.soccer`;
}
