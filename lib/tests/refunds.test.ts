import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getCurrentProfile: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("../supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
  getCurrentProfile: mocks.getCurrentProfile
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { recordPlayerRefund } from "../actions/refunds";

const playerId = "11111111-1111-4111-8111-111111111111";
const summerId = "22222222-2222-4222-8222-222222222222";
const fallId = "33333333-3333-4333-8333-333333333333";
const submissionId = "44444444-4444-4444-8444-444444444444";

function refundForm(amount: string, seasonId = summerId) {
  const data = new FormData();
  data.set("player_id", playerId);
  data.set("season_id", seasonId);
  data.set("submission_id", submissionId);
  data.set("amount", amount);
  data.set("refund_date", "2026-09-20");
  data.set("method", "e-transfer");
  data.set("reference", "TRANSFER-123");
  return data;
}

describe("recordPlayerRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ role: "admin" });
    mocks.rpc.mockResolvedValue({ data: "55555555-5555-4555-8555-555555555555", error: null });
  });

  it.each(["25.00", "12.50"])("records a full or partial completed refund of %s", async (amount) => {
    await recordPlayerRefund(null, refundForm(amount));
    expect(mocks.rpc).toHaveBeenCalledWith("record_player_refund", expect.objectContaining({
      p_player_id: playerId,
      p_season_id: summerId,
      p_amount: amount,
      p_refund_date: "2026-09-20",
      p_method: "e-transfer",
      p_reference: "TRANSFER-123",
      p_submission_id: submissionId
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mocks.redirect).toHaveBeenCalledWith("/payments?success=refund_saved");
  });

  it("allows the same workflow for an inactive player and another season", async () => {
    mocks.getCurrentProfile.mockResolvedValue({ role: "admin", player_status: "inactive" });
    await recordPlayerRefund(null, refundForm("10.00", fallId));
    expect(mocks.rpc).toHaveBeenCalledWith("record_player_refund", expect.objectContaining({ p_season_id: fallId }));
  });

  it("returns the database credit-limit error without confirming a refund", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Refund exceeds current season credit of 10.00" } });
    expect(await recordPlayerRefund(null, refundForm("20.00"))).toEqual({
      error: "Refund exceeds current season credit of 10.00"
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("reuses the submission ID on a retry so the database can return the existing refund", async () => {
    await recordPlayerRefund(null, refundForm("12.50"));
    await recordPlayerRefund(null, refundForm("12.50"));
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_submission_id)).toEqual([submissionId, submissionId]);
  });

  it("rejects invalid amounts and non-admin submissions before the database call", async () => {
    expect(await recordPlayerRefund(null, refundForm("12.345"))).toMatchObject({ error: expect.any(String) });
    mocks.getCurrentProfile.mockResolvedValue({ role: "captain" });
    expect(await recordPlayerRefund(null, refundForm("12.50"))).toEqual({ error: "Only admins can record refunds." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
