import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureScheduleCard, type FixtureScheduleItem } from "@/components/FixtureScheduleCard";
import { FixtureImage } from "@/components/FixtureShareButton";
import { canShareImage, fixtureBreakMinutes, fixtureImageName, fixtureTimeRange, shareImage } from "@/lib/fixture-sharing";

const matches: FixtureScheduleItem[] = [
  { matchNumber: 2, teamAName: "Second A", teamBName: "Second B", homeTeamName: "Second B", awayTeamName: "Second A", scheduledStartTime: "07:20:00", scheduledEndTime: "07:35:00" },
  { matchNumber: 1, teamAName: "First A", teamBName: "First B", homeTeamName: "First A", awayTeamName: "First B", scheduledStartTime: "07:00:00", scheduledEndTime: "07:15:00" }
];

afterEach(() => vi.unstubAllGlobals());

describe("saved fixture sharing", () => {
  it("only shows Share for authorized viewers of a nonempty saved schedule", () => {
    expect(renderToStaticMarkup(<FixtureScheduleCard matches={matches} />)).not.toContain(">Share<");
    expect(renderToStaticMarkup(<FixtureScheduleCard matches={[]} canShare />)).not.toContain(">Share<");
    const html = renderToStaticMarkup(<FixtureScheduleCard matches={matches} canShare sessionLabel="Sunday" sessionDate="2026-10-04" />);
    expect(html).toContain(">Share<");
    expect(html.indexOf("G1")).toBeLessThan(html.indexOf("G2"));
  });

  it("exports all games, date, breaks and venue assignments without scores or controls", () => {
    const sorted = [...matches].reverse();
    const html = renderToStaticMarkup(<FixtureImage matches={sorted} sessionLabel="Sunday" sessionDate="2026-10-04" />);
    for (const text of ["Sunday", "October 4, 2026", "G1", "G2", "7:00 AM-7:15 AM", "Break: 5 min", "Home: ", "Away: ", "Second B"]) expect(html).toContain(text);
    for (const text of ["<button", "Game scores", "truncate", "<nav"]) expect(html).not.toContain(text);
    expect(html).toContain("width:900px");
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("retains finals placeholders and handles missing times or assignments", () => {
    const html = renderToStaticMarkup(<FixtureImage matches={[{ matchNumber: 7, teamAName: "1st ranked team", teamBName: "2nd ranked team" }]} sessionLabel="Finals" />);
    expect(html).toContain("1st ranked team");
    expect(html).toContain("TBD");
    expect(html).toContain("Not assigned");
    expect(fixtureBreakMinutes(null, "08:00")).toBe(0);
    expect(fixtureBreakMinutes("08:00", "07:00")).toBe(0);
    expect(fixtureTimeRange("12:00", "13:05")).toBe("12:00 PM-1:05 PM");
    expect(fixtureImageName("Sunday / Finals!", "2026-10-04")).toBe("sunday-finals-2026-10-04-fixture.png");
  });
});

describe("native image sharing", () => {
  const file = new File(["png"], "fixture.png", { type: "image/png" });

  it("supports download fallback when file sharing is missing or throws", () => {
    vi.stubGlobal("navigator", {});
    expect(canShareImage(file)).toBe(false);
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
    expect(canShareImage(file)).toBe(false);
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => { throw new Error("unsupported"); } });
    expect(canShareImage(file)).toBe(false);
  });

  it("shares exactly one PNG from an explicit user action", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true });
    expect(canShareImage(file)).toBe(true);
    expect(await shareImage(file, "Sunday fixture")).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ files: [file], title: "Sunday fixture" });
  });

  it("treats cancellation normally but propagates real sharing failures", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    vi.stubGlobal("navigator", { share });
    expect(await shareImage(file, "Sunday")).toBe("cancelled");
    share.mockRejectedValue(new Error("Permission denied"));
    await expect(shareImage(file, "Sunday")).rejects.toThrow("Permission denied");
  });
});
