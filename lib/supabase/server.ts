import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseEnv();

  return createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot always write cookies; middleware refreshes sessions.
          }
        }
      }
    }
  );
}

export async function getCurrentProfile(): Promise<any> {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return { authError: authError.message };
  if (!auth.user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (error) return { authUserEmail: auth.user.email, profileError: error.message };
  if (data) return data;

  const displayName =
    typeof auth.user.user_metadata?.display_name === "string"
      ? auth.user.user_metadata.display_name
      : auth.user.email?.split("@")[0] ?? "Player";

  const { data: created, error: createError } = await supabase
    .from("profiles")
    .insert({
      id: auth.user.id,
      display_name: displayName,
      email: auth.user.email,
      role: "player"
    })
    .select("*")
    .single();
  if (createError) {
    return {
      authUserEmail: auth.user.email,
      profileError: `Profile missing and auto-create failed: ${createError.message}`
    };
  }

  return created;
}
