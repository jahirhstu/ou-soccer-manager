import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalsAssistsShareImage, type GoalsAssistsRow } from "@/components/GoalsAssistsShareImage";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), pathname: "/public/goals-assists", shares: [] as any[] }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/tenant-server", () => ({ getRequestTenantSlug: async () => "ou-soccer", getRequestProgramSlug: async () => "football" }));
vi.mock("@/components/PublicShell", () => ({ PublicShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/ImageShareButton", () => ({ ImageShareButton: (props: any) => { mocks.shares.push(props); return <div data-share-export><button>{props.label}</button>{props.children}</div>; } }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
import GoalsAssistsPage from "../../app/public/goals-assists/page";
import { AppNav } from "@/components/AppNav";

const makeRow = (player_name: string, season_id = "fall", goals = 4): GoalsAssistsRow => ({ player_name, season_id, season_name: season_id === "fall" ? "Fall 2026" : "Summer 2026", goals, assists: 2, sessions_count: 3, games_count: 9, goals_per_game: "0.44", assists_per_game: "0.22", goal_contributions_per_game: "0.67" });
beforeEach(() => {
  mocks.shares.length = 0;
  mocks.pathname = "/public/goals-assists";
  mocks.rpc.mockImplementation(async (name: string) => name === "scoped_public_sessions" ? { data: [{ id: "session", name: "Sunday football", session_date: "2026-10-04", season_name: "Fall 2026" }], error: null } : { data: [makeRow("Jahir"), makeRow("Shaiful", "fall", 6), makeRow("Jahir", "summer", 8)], error: null });
});

describe("Goals & Assists admin navigation", () => {
  it("shows the existing public page in the admin menu with the active tenant path", () => {
    mocks.pathname = "/ou-soccer/football/public/goals-assists";
    const html = renderToStaticMarkup(<AppNav role="admin" tenantSlug="ou-soccer" programSlug="football" />);
    expect(html).toContain('href="/ou-soccer/football/public/goals-assists"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Goals &amp; Assists");
    expect(html).not.toContain('href="/ou-soccer/football/public/field-status"');
  });
  it("preserves public availability and existing captain visibility", () => {
    expect(renderToStaticMarkup(<AppNav role="player" variant="public" />)).toContain('href="/public/goals-assists"');
    expect(renderToStaticMarkup(<AppNav role="captain" />)).not.toContain('href="/public/goals-assists"');
  });
});

describe("filtered Goals & Assists sharing", () => {
  it("shares only applied player/season results and includes all metrics and filter context", async () => {
    const html = renderToStaticMarkup(await GoalsAssistsPage({ searchParams: Promise.resolve({ player: "JAH", season: "fall", session: "session" }) }));
    expect(mocks.rpc).toHaveBeenCalledWith("scoped_public_goals_assists", { p_organization_slug: "ou-soccer", p_program_slug: "football", p_session_id: "session" });
    expect(mocks.shares).toHaveLength(1);
    const share = mocks.shares[0];
    expect(share.children.props.rows).toEqual([makeRow("Jahir")]);
    expect(share.children.props.seasonLabel).toBe("Fall 2026");
    expect(share.children.props.sessionLabel).toContain("2026-10-04 | Sunday football");
    expect(share.children.props.playerFilter).toBe("JAH");
    expect(html).toContain("Share list");
    expect(html).toContain("Goals / game");
    expect(html).toContain("Assists / game");
    expect(html).toContain("G+A / game");
    expect(share.filename).toMatch(/\.png$/);
    expect(share.maxPageHeight).toBeUndefined();
    expect(html.indexOf("</form>")).toBeLessThan(html.indexOf("Share list"));
  });
  it("shares every unfiltered row in the existing report order", async () => {
    renderToStaticMarkup(await GoalsAssistsPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.rpc).toHaveBeenCalledWith("scoped_public_goals_assists", { p_organization_slug: "ou-soccer", p_program_slug: "football", p_session_id: null });
    expect(mocks.shares[0].children.props.rows.map((row: GoalsAssistsRow) => `${row.player_name}:${row.season_id}`)).toEqual(["Jahir:summer", "Shaiful:fall", "Jahir:fall"]);
    expect(mocks.shares[0].children.props.seasonLabel).toBe("All seasons");
    expect(mocks.shares[0].children.props.sessionLabel).toBe("All sessions");
  });
  it("preserves requested ordering when applying filters", async () => {
    const html = renderToStaticMarkup(await GoalsAssistsPage({ searchParams: Promise.resolve({ season: "fall", sort: "player" }) }));
    expect(mocks.shares[0].children.props.rows.map((row: GoalsAssistsRow) => row.player_name)).toEqual(["Jahir", "Shaiful"]);
    expect(html).toContain('name="sort"');
    expect(html).toContain('value="player"');
  });
  it("does not offer sharing for empty or failed reports", async () => {
    const empty = renderToStaticMarkup(await GoalsAssistsPage({ searchParams: Promise.resolve({ player: "No match" }) }));
    expect(empty).toContain("No goals or assists match this filter.");
    expect(mocks.shares).toHaveLength(0);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Failed" } });
    const error = renderToStaticMarkup(await GoalsAssistsPage({ searchParams: Promise.resolve({}) }));
    expect(error).toContain("Goals and assists are not ready yet");
    expect(mocks.shares).toHaveLength(0);
  });
});

describe("complete Goals & Assists export layout", () => {
  it("keeps long reports, repeated players across seasons and every statistic", () => {
    const rows = Array.from({ length: 60 }, (_, index) => makeRow(`Player ${index + 1}`, index % 2 ? "fall" : "summer", index));
    const html = renderToStaticMarkup(<GoalsAssistsShareImage rows={rows} seasonLabel="All seasons" sessionLabel="All sessions" />);
    for (const row of rows) expect(html).toContain(row.player_name);
    for (const label of ["Sessions", "Games", "Goals / game", "Assists / game", "G+A / game", "0.44", "0.22", "0.67"]) expect(html).toContain(label);
    expect(html).toContain("width:640px");
    expect(html).not.toContain("max-height");
    expect(html).not.toContain("truncate");
  });
  it("renders null metrics as zero and escapes names and filter labels", () => {
    const row = { ...makeRow("<Player>"), goals: null, assists: null, sessions_count: null, games_count: null, goals_per_game: null, assists_per_game: null, goal_contributions_per_game: null };
    const html = renderToStaticMarkup(<GoalsAssistsShareImage rows={[row]} seasonLabel="Fall & Winter" sessionLabel="All sessions" playerFilter="<Player>" />);
    expect(html).toContain("&lt;Player&gt;");
    expect(html).toContain("Fall &amp; Winter");
    expect(html.match(/>0</g)).toHaveLength(7);
  });
});
