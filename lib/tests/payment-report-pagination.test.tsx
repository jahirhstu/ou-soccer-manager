import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: [] as any[], error: null as null | { message: string } }));
vi.mock("../../app/(shell)", () => ({ AppShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  from: (table: string) => {
    const query: any = { select: () => query, order: () => query, eq: () => query,
      then: (resolve: any) => Promise.resolve({ data: table === "player_season_payment_summary" ? mock.rows : table === "attendance" ? [{ player_id: "p02" }] : [], error: mock.error }).then(resolve) };
    return query;
  }
}) }));
import PaymentReport from "../../app/reports/payments/page";
const render = (filters = {}) => PaymentReport({ searchParams: Promise.resolve(filters) }).then(renderToStaticMarkup);
const csv = (html: string) => { const href = html.match(/href="(data:text\/csv[^\"]+)"/)![1]; return decodeURIComponent(href.slice(href.indexOf(",") + 1)); };
beforeEach(() => {
  mock.error = null;
  mock.rows = Array.from({ length: 27 }, (_, i) => ({ player_id: `p${String(i).padStart(2, "0")}`, player_name: `Player ${String(i).padStart(2, "0")}`, season_id: "fall", season_name: "Fall", total_paid_amount: i, estimated_used_amount: 30, credit_amount: 0, owes_money: 30 - i }));
});
describe("payment report pagination", () => {
  it("renders 25 records by default and exports all 27", async () => {
    const html = await render();
    expect(html).toContain("Showing 1–25 of 27");
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain("View details");
    expect(html).not.toContain(">Player 25<");
    expect(csv(html).split("\n")).toHaveLength(28);
  });
  it("preserves filters and displays the final page", async () => {
    const html = await render({ page: "3", pageSize: "10", season: "fall", status: "owes", sort: "paid" });
    expect(html).toContain("Showing 21–27 of 27");
    expect(html).toContain("season=fall");
    expect(html).toContain("pageSize=10");
    expect(html).toContain("page=2");
    expect(html).toContain(">Player 00<");
    expect(html).not.toContain(">Player 26<");
    expect(html).not.toContain('name="page"');
  });
  it("normalizes invalid parameters and clamps oversized pages", async () => {
    for (const page of ["-3", "1.2", "bad", "Infinity"]) expect(await render({ page, pageSize: "3" })).toContain("Showing 1–25 of 27");
    expect(await render({ page: "99" })).toContain("Showing 26–27 of 27");
  });
  it("filters by season, player, status and session before paginating", async () => {
    expect(await render({ player: "Player 02", status: "owes", season: "fall", sessionId: "session" })).toContain("Showing 1–1 of 1");
    expect(await render({ season: "summer" })).toContain("No payment records match these filters.");
    expect(await render({ season: "summer" })).toContain("Showing 0–0 of 0");
  });
  it("escapes CSV quotes, commas and newlines", async () => {
    mock.rows[0].player_name = 'Name, "Quoted"\nNext';
    expect(csv(await render())).toContain('"Name, ""Quoted""\nNext"');
  });
  it("breaks duplicate-name ties by stable identifiers before paging", async () => {
    mock.rows.reverse(); mock.rows.forEach(row => { row.player_name = "Same"; });
    const lines = csv(await render()).split("\n");
    expect(lines[1]).toContain("Same,Fall,0,");
    expect(lines[27]).toContain("Same,Fall,26,");
  });
  it("surfaces query failures instead of showing empty balances", async () => {
    mock.error = { message: "Report unavailable" };
    await expect(render()).rejects.toThrow("Report unavailable");
  });
});
