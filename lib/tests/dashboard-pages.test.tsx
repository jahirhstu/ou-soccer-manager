import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), replace: vi.fn(), tenant: vi.fn(), program: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from, rpc: mocks.rpc }),
  getCurrentProfile: async () => ({ role: "admin", organization_id: "org" }),
  getCurrentProgram: async () => ({ id: "program" })
}));
vi.mock("@/lib/tenant-server", () => ({ getRequestTenantSlug: mocks.tenant, getRequestProgramSlug: mocks.program }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock("../../app/(shell)", () => ({ AppShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/PublicShell", () => ({ PublicShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/PaymentSentButton", () => ({ PaymentSentButton: () => null }));

import Dashboard from "../../app/dashboard/page";
import PublicReport from "../../app/public/report/page";

const seasons = [
  { id: "fall", name: "Fall", status: "draft", price_per_session: 13, program_id: "program", start_date: "2026-09-01" },
  { id: "summer", name: "Summer", status: "active", price_per_session: 12, program_id: "program", start_date: "2026-05-01" }
];
const reportRows = [
  { season_id: "summer", season_name: "Summer", player_id: "laith", player_name: "Laith", estimated_used_amount: 24, owes_money: 24, balance_amount: -24 },
  { season_id: "fall", season_name: "Fall", player_id: "zayan", player_name: "Zayan", estimated_used_amount: 13, owes_money: 13, balance_amount: -13 }
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant.mockResolvedValue("ou-soccer"); mocks.program.mockResolvedValue("football");
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "public_report_season") return { data: [{ season_id: "summer", season_name: "Summer" }], error: null };
    if (name === "public_player_report") return { data: reportRows, error: null };
    if (name === "admin_dashboard_season_finance") return { data: [{ signup_collected: 120, drop_in_collected: 24, total_collected: 144, total_expenses: 20, total_refunded: 12, club_balance: 112, total_player_credit: 25, net_club_balance: 87, total_waived: args.p_season_id === "summer" ? 48 : 0, player_count: 2 }], error: null };
    if (name === "admin_club_transfer_summary") return { data: [{ season_result: 87, carried_in: 0, carried_out: 0, balance_remaining: 87 }], error: null };
    return { data: [], error: null };
  });
  mocks.from.mockImplementation((table) => {
    const query: any = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      then(resolve: any) { return Promise.resolve({ data: table === "seasons" ? seasons : [], count: table === "sessions" ? 20 : null, error: null }).then(resolve); }
    };
    return query;
  });
});

describe("dashboard season cards", () => {
  it("defaults to active and preserves the original used-charge calculation", async () => {
    const html = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Net session charges");
    expect(html).toContain("$24.00");
    expect(html).toContain("Net Club Balance"); expect(html).toContain("$87.00");
    expect(html).toContain("Season result before transfers");
    expect(html).toContain("Carry club balance forward");
    expect(html).toContain("Total Waived"); expect(html).toContain("$48.00");
    expect(html).toContain("Summer (Active)");
    expect(mocks.rpc).toHaveBeenCalledWith("admin_dashboard_season_finance", { p_season_id: "summer" });
    expect(html).not.toContain("Total charged(used)");
  });

  it("refreshes the report scope for a selected historical season", async () => {
    const html = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({ season: "fall" }) }));
    expect(mocks.rpc).toHaveBeenCalledWith("admin_dashboard_season_finance", { p_season_id: "fall" });
    expect(html).toContain("$13.00");
    const sessionQueries = mocks.from.mock.results.filter((_, i) => mocks.from.mock.calls[i][0] === "sessions");
    for (const result of sessionQueries) expect(result.value.eq).toHaveBeenCalledWith("season_id", "fall");
  });
});

describe("public active-season report", () => {
  it("ignores a legacy season URL and scopes players and all highlights to the resolved season", async () => {
    const html = renderToStaticMarkup(await PublicReport({ searchParams: Promise.resolve({ season: "fall" }) }));
    expect(html).toContain("Laith"); expect(html).not.toContain("Zayan");
    expect(html).not.toContain('name="season"');
    for (const name of ["public_dashboard_highlights", "public_longest_winning_streaks", "public_latest_winning_streaks"]) {
      expect(mocks.rpc).toHaveBeenCalledWith(name, { p_season_id: "summer" });
    }
  });

  it("keeps player search within the resolved season", async () => {
    const html = renderToStaticMarkup(await PublicReport({ searchParams: Promise.resolve({ q: "Zayan" }) }));
    expect(html).not.toContain('<h2 class="truncate text-lg font-semibold text-ink">Zayan');
    expect(html).not.toContain('<h2 class="truncate text-lg font-semibold text-ink">Laith');
  });

  it("never requests all-season highlights when no season exists", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const html = renderToStaticMarkup(await PublicReport({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("No seasons configured");
    expect(mocks.rpc).not.toHaveBeenCalledWith("public_dashboard_highlights", expect.anything());
    expect(mocks.rpc).not.toHaveBeenCalledWith("public_player_report");
  });
});
