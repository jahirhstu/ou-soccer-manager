import { supabase } from "./supabase";

const webUrl = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, "");

export async function mobileApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!webUrl) throw new Error("EXPO_PUBLIC_WEB_URL is not configured.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Authentication required.");
  const response = await fetch(`${webUrl}/api/mobile${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
  return result as T;
}

export async function mobileFormApi<T>(path: string, body: FormData): Promise<T> {
  if (!webUrl) throw new Error("EXPO_PUBLIC_WEB_URL is not configured.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Authentication required.");
  const response = await fetch(`${webUrl}/api/mobile${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
  return result as T;
}
