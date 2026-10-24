import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/(shell)", () => ({ AppShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  from: (table: string) => ({ select: () => ({
    order: async () => ({ data: [] }),
    then: (resolve: any) => Promise.resolve({ data: table === "player_season_payment_summary" ? [{
      player_id: "player", player_name: "Settled source", season_id: "summer", season_name: "Summer",
      total_paid_amount: 0, owes_money: 0, credit_amount: 0
    }] : table === "player_season_transfer_summary" ? [{
      player_id: "player", season_id: "summer", debt_transfer_out_amount: 24
    }] : [] }).then(resolve)
  }) })
}) }));
import PaymentReport from "../../app/reports/payments/page";

describe("balance transfers in payment reports", () => {
  it("includes transferred debt in the settled filter and CSV exactly once", async () => {
    const html = renderToStaticMarkup(await PaymentReport({ searchParams: Promise.resolve({ status: "settled" }) }));
    expect(html).toContain("Settled source");
    expect(html).toContain("Owing transfer out");
    expect(html).toContain("$24.00");
    const href = html.match(/href="(data:text\/csv[^\"]+)"/)![1];
    const csv = decodeURIComponent(href.slice(href.indexOf(",") + 1));
    expect(csv).toContain("Owing transfer in,Owing transfer out");
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv.split("\n")[1].split(",")[12]).toBe("24");
  });
});
