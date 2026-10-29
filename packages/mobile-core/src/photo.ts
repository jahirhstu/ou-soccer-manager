import type { SupabaseClient } from "@supabase/supabase-js";

export async function saveProfilePhoto(client: SupabaseClient, userId: string, bytes: ArrayBuffer, previous: string | null) {
  if (!bytes.byteLength) throw new Error("The selected photo is empty. Please choose another photo.");
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("Choose a smaller photo (maximum 2 MB).");
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const storage = client.storage.from("profile-photos");
  const uploaded = await storage.upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (uploaded.error) throw uploaded.error;
  const saved = await client.rpc("set_my_photo", { p_path: path });
  if (saved.error) {
    // A lost response may follow a committed update. Retain the new object on
    // uncertainty so the profile cannot point to a deleted image.
    throw saved.error;
  }
  if (previous && previous !== path) {
    // Cleanup failure must not turn a successfully saved photo into an error.
    try { await storage.remove([previous]); } catch { /* Retry cleanup independently. */ }
  }
  return path;
}
