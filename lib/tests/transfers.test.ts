import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getCurrentProfile: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn() }));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }), getCurrentProfile: mocks.getCurrentProfile }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { carryForwardPlayerCredit } from "../actions/transfers";

const playerId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const destinationId = "33333333-3333-4333-8333-333333333333";
const submissionId = "44444444-4444-4444-8444-444444444444";

function form(amount: string, destination = destinationId) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ player_id: playerId, source_season_id: sourceId, destination_season_id: destination, submission_id: submissionId, amount, transfer_date: "2026-09-20", note: "Winter to Fall" })) data.set(key, value);
  return data;
}

describe("carryForwardPlayerCredit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ role: "admin" });
    mocks.rpc.mockResolvedValue({ data: "55555555-5555-4555-8555-555555555555", error: null });
  });

  it.each(["25.00", "12.50"])("records full or partial credit of %s", async (amount) => {
    await carryForwardPlayerCredit(null, form(amount));
    expect(mocks.rpc).toHaveBeenCalledWith("carry_forward_player_credit", expect.objectContaining({
      p_player_id: playerId, p_source_season_id: sourceId, p_destination_season_id: destinationId,
      p_amount: amount, p_submission_id: submissionId
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mocks.redirect).toHaveBeenCalledWith("/payments?success=transfer_saved");
  });

  it("preserves the submission ID on retry", async () => {
    await carryForwardPlayerCredit(null, form("12.00"));
    await carryForwardPlayerCredit(null, form("12.00"));
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_submission_id)).toEqual([submissionId, submissionId]);
  });

  it("shows a current-credit or same-program rejection from the database", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "Transfer exceeds current source-season credit" } });
    expect(await carryForwardPlayerCredit(null, form("99.00"))).toEqual({ error: "Transfer exceeds current source-season credit" });
    mocks.rpc.mockResolvedValueOnce({ error: { message: "Both seasons must belong to the same program and organization" } });
    expect(await carryForwardPlayerCredit(null, form("10.00"))).toEqual({ error: "Both seasons must belong to the same program and organization" });
  });

  it("rejects invalid amounts, same season and non-admin submissions", async () => {
    expect(await carryForwardPlayerCredit(null, form("1.234"))).toMatchObject({ error: expect.any(String) });
    expect(await carryForwardPlayerCredit(null, form("1.00", sourceId))).toEqual({ error: "Choose two different seasons." });
    mocks.getCurrentProfile.mockResolvedValue({ role: "captain" });
    expect(await carryForwardPlayerCredit(null, form("1.00"))).toEqual({ error: "Only admins can carry credit forward." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
