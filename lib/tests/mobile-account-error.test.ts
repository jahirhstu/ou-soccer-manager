import { expect, it } from "vitest";
import { accountLoadError } from "../../packages/contracts/src";

it("explains missing native RPCs without hiding structured Supabase errors", () => {
  expect(accountLoadError({ code: "PGRST202", message: "Missing RPC" })).toContain("native-app database migration");
  expect(accountLoadError({ code: "42883" })).toContain("native-app database migration");
  expect(accountLoadError({ message: "Authentication required" })).toBe("Authentication required");
  expect(accountLoadError(new Error("Network request failed"))).toBe("Network request failed");
  expect(accountLoadError(null)).toContain("check your connection");
});
