import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveProfilePhoto } from "../../packages/mobile-core/src/photo";

function setup() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ upload, remove });
  return { client: { storage: { from }, rpc } as unknown as SupabaseClient, upload, remove, rpc, from };
}
it("uploads JPEG bytes, links the profile, then removes the old photo", async () => {
  const s = setup(), bytes = new ArrayBuffer(20);
  const path = await saveProfilePhoto(s.client, "user", bytes, "user/old.jpg");
  expect(s.from).toHaveBeenCalledWith("profile-photos");
  expect(s.upload).toHaveBeenCalledWith(path, bytes, { contentType: "image/jpeg", upsert: false });
  expect(s.rpc).toHaveBeenCalledWith("set_my_photo", { p_path: path });
  expect(s.remove).toHaveBeenCalledWith(["user/old.jpg"]);
  expect(s.rpc.mock.invocationCallOrder[0]).toBeLessThan(s.remove.mock.invocationCallOrder[0]);
});
it("rejects empty and oversized images before making requests", async () => {
  const s = setup();
  for (const size of [0, 2097153]) await expect(saveProfilePhoto(s.client, "user", new ArrayBuffer(size), null)).rejects.toThrow();
  expect(s.upload).not.toHaveBeenCalled();
});
it("preserves the existing profile on upload failure", async () => {
  const s = setup(); s.upload.mockResolvedValue({ error: { message: "Upload denied" } });
  await expect(saveProfilePhoto(s.client, "user", new ArrayBuffer(1), "old")).rejects.toEqual({ message: "Upload denied" });
  expect(s.rpc).not.toHaveBeenCalled(); expect(s.remove).not.toHaveBeenCalled();
});
it("retains both files if linking fails or its response is uncertain", async () => {
  const s = setup(); s.rpc.mockResolvedValue({ error: { message: "Network interrupted" } });
  await expect(saveProfilePhoto(s.client, "user", new ArrayBuffer(1), "old")).rejects.toBeTruthy();
  expect(s.remove).not.toHaveBeenCalled();
});
it("does not fail a saved photo when old-file cleanup fails", async () => {
  const s = setup(); s.remove.mockRejectedValue(new Error("Offline"));
  await expect(saveProfilePhoto(s.client, "user", new ArrayBuffer(1), "old")).resolves.toMatch(/^user\//);
});
