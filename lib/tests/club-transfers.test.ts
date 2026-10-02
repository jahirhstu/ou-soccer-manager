import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getCurrentProfile: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn() }));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }), getCurrentProfile: mocks.getCurrentProfile }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { recordClubBalanceTransfer, reverseClubBalanceTransfer } from "../actions/club-transfers";

const source = "11111111-1111-4111-8111-111111111111";
const destination = "22222222-2222-4222-8222-222222222222";
const submission = "33333333-3333-4333-8333-333333333333";
const transferId = "44444444-4444-4444-8444-444444444444";

function form(amount: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ source_season_id: source, destination_season_id: destination,
    submission_id: submission, amount, transfer_date: "2026-09-30", note: "Season close", confirmed: "yes" })) data.set(key, value);
  return data;
}

describe("club balance transfer actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentProfile.mockResolvedValue({ role: "admin" });
    mocks.rpc.mockResolvedValue({ data: transferId, error: null });
  });

  it.each(["25.00", "12.34", "-20.00"])("sends signed %s to the atomic RPC", async (amount) => {
    await recordClubBalanceTransfer(null, form(amount));
    expect(mocks.rpc).toHaveBeenCalledWith("record_club_balance_transfer", expect.objectContaining({
      p_source_season_id: source, p_destination_season_id: destination,
      p_amount: amount, p_submission_id: submission
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mocks.redirect).toHaveBeenCalledWith(`/dashboard?season=${source}&success=club_transfer_saved`);
  });

  it("returns database rejections and requires admin confirmation", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "Assign all unallocated program expenses" } });
    expect(await recordClubBalanceTransfer(null, form("10.00"))).toEqual({ error: "Assign all unallocated program expenses" });
    const unchecked = form("10.00"); unchecked.delete("confirmed");
    expect(await recordClubBalanceTransfer(null, unchecked)).toMatchObject({ error: expect.any(String) });
    mocks.getCurrentProfile.mockResolvedValue({ role: "captain" });
    expect(await recordClubBalanceTransfer(null, form("10.00"))).toEqual({ error: "Only admins can carry club balances forward." });
  });

  it("reverses by ID with a unique submission key", async () => {
    const data = new FormData();
    data.set("transfer_id", transferId); data.set("submission_id", submission);
    data.set("season_id", source); data.set("confirmed", "yes");
    await reverseClubBalanceTransfer(data);
    expect(mocks.rpc).toHaveBeenCalledWith("reverse_club_balance_transfer", {
      p_transfer_id: transferId, p_submission_id: submission
    });
    expect(mocks.redirect).toHaveBeenCalledWith(`/dashboard?season=${source}&success=club_transfer_reversed`);
  });
});
