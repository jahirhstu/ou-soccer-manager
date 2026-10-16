import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { amountInCents, centsAmount, creditTransferPreview } from "@/lib/player-credit";
import { balanceTransferLabel } from "@/lib/transfers";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), profile: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }), getCurrentProfile: mocks.profile }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { transferPlayerCredit } from "@/lib/actions/player-credit";
import { PaymentSourceForm } from "@/components/PaymentSourceForm";

const funding = "11111111-1111-4111-8111-111111111111", recipient = "22222222-2222-4222-8222-222222222222";
const season = "33333333-3333-4333-8333-333333333333", submission = "44444444-4444-4444-8444-444444444444";
const balances = [{ playerId: funding, seasonId: season, credit: "40.00", owes: "0" }, { playerId: recipient, seasonId: season, credit: "0", owes: "13.00" }];
function form(overrides: Record<string, string> = {}) {
  const result = new FormData();
  Object.entries({ funding_player_id: funding, recipient_player_id: recipient, season_id: season, submission_id: submission,
    amount: "13.00", transfer_date: "2020-10-04", session_id: "", note: "Guest fee", confirmed: "on", ...overrides }).forEach(([key, value]) => result.set(key, value));
  return result;
}
beforeEach(() => { vi.clearAllMocks(); mocks.profile.mockResolvedValue({ role: "admin" }); mocks.rpc.mockResolvedValue({ error: null }); });

describe("player credit preview and form", () => {
  it("uses exact cents and validates amount precision", () => {
    expect(amountInCents("0.29")).toBe(BigInt(29));
    expect(amountInCents("12.3")).toBe(BigInt(1230));
    for (const value of ["1.234", "NaN", "-1", "1e3", ""]) expect(amountInCents(value)).toBeNull();
    expect(centsAmount(BigInt(-1234))).toBe("-12.34");
    const preview = creditTransferPreview(balances, season, funding, recipient, "20.00");
    expect(preview).toMatchObject({ valid: true, sourceAfter: BigInt(2000), targetAfter: BigInt(700) });
    expect(creditTransferPreview(balances, season, funding, recipient, "40.01").valid).toBe(false);
    expect(creditTransferPreview(balances, season, funding, funding, "1").valid).toBe(false);
    expect(creditTransferPreview(balances, "other-season", funding, recipient, "1").valid).toBe(false);
  });
  it("preserves external payment content and hides it in credit mode", () => {
    const props = { players: [], seasons: [], sessions: [], balances, submissionId: submission, today: "2026-10-16" };
    const external = renderToStaticMarkup(<PaymentSourceForm {...props} initialSource="external"><form><input name="payment_method" /><input name="sessions_covered" /></form></PaymentSourceForm>);
    expect(external).toContain('name="payment_method"');
    const credit = renderToStaticMarkup(<PaymentSourceForm {...props} initialSource="credit"><form><input name="payment_method" /></form></PaymentSourceForm>);
    expect(credit).toContain("Transfer player credit");
    expect(credit).toContain('name="recipient_player_id"');
    expect(credit).toContain('name="confirmed"');
    expect(credit).not.toContain('name="payment_method"');
    expect(credit).not.toContain('name="sessions_covered"');
  });
  it("distinguishes player transfers from existing carry-forward labels", () => {
    expect(balanceTransferLabel("credit_transferred_out", recipient, "Guest")).toBe("Credit sent to Guest");
    expect(balanceTransferLabel("credit_transferred_in", funding, "Funding player")).toBe("Credit received from Funding player");
    expect(balanceTransferLabel("credit_transferred_in")).toBe("Credit in");
    expect(balanceTransferLabel("debt_transferred_out")).toBe("Owing out");
  });
});

describe("transferPlayerCredit action", () => {
  it("passes money as a decimal string and refreshes both player histories", async () => {
    await transferPlayerCredit(null, form({ amount: "0.29" }));
    expect(mocks.rpc).toHaveBeenCalledWith("transfer_player_credit", expect.objectContaining({ p_amount: "0.29", p_submission_id: submission, p_session_id: null }));
    for (const path of [`/players/${funding}`, `/players/${recipient}`, "/dashboard", "/public/report", "/reports/payments", "/payments/new"]) expect(mocks.revalidate).toHaveBeenCalledWith(path);
    expect(mocks.redirect).toHaveBeenCalledWith("/payments?success=player_credit_transferred");
  });
  it("preserves idempotency keys and optional session context", async () => {
    await transferPlayerCredit(null, form({ session_id: season }));
    await transferPlayerCredit(null, form({ session_id: season }));
    expect(mocks.rpc.mock.calls.map(call => call[1].p_submission_id)).toEqual([submission, submission]);
    expect(mocks.rpc.mock.calls[0][1].p_session_id).toBe(season);
  });
  it("returns database rejections without success or invalidation", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "Transfer exceeds current season credit" } });
    expect(await transferPlayerCredit(null, form())).toEqual({ error: "Transfer exceeds current season credit" });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("rejects unauthorized, unconfirmed, self and malformed transfers", async () => {
    mocks.profile.mockResolvedValue({ role: "captain" });
    expect(await transferPlayerCredit(null, form())).toMatchObject({ error: expect.any(String) });
    mocks.profile.mockResolvedValue({ role: "admin" });
    const invalidCases: Record<string, string>[] = [{ confirmed: "" }, { recipient_player_id: funding }, { amount: "1.234" }, { amount: "0" }, { amount: "100000000" }];
    for (const overrides of invalidCases) {
      expect(await transferPlayerCredit(null, form(overrides))).toMatchObject({ error: expect.any(String) });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
