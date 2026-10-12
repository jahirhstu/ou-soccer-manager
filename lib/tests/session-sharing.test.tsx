import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayersShareImage, ResultsShareImage, StandingsShareImage, TeamsShareImage, type ShareStanding } from "@/components/SessionShareImages";
import { canShareImages, imageFileName, shareImages } from "@/lib/image-sharing";

const session = { name: "Sunday Football", date: "2026-10-04", location: "Bell Senseplex, Field 2" };
const standing: ShareStanding = { teamId: "a", teamName: "Team Ahmed", rank: 1, played: 8, wins: 4, draws: 2, losses: 2, goalsFor: 12, goalsAgainst: 9, goalDifference: 3, awayGoals: 7, points: 14 };
afterEach(() => vi.unstubAllGlobals());

describe("phone-readable session images", () => {
  it("includes podium, all standings statistics, date and location", () => {
    const html = renderToStaticMarkup(<StandingsShareImage session={session} standings={[standing]} />);
    for (const value of ["Podium", "Standings", "Team Ahmed", "GF 12", "GA 9", "GD +3", "AG 7", "P 8", "W 4", "D 2", "L 2", "14", session.date, session.location]) expect(html).toContain(value);
    expect(html).toContain("width:640px");
    expect(html).toContain("font-size:30px");
    expect(html).not.toContain("truncate");
  });

  it("retains every scorer and assist and compacts uneven lists into two columns", () => {
    const scorers = Array.from({ length: 21 }, (_, index) => ({ playerName: `Scorer ${index + 1}`, teamNames: "Team A", total: index + 1 }));
    const html = renderToStaticMarkup(<PlayersShareImage session={session} scorers={scorers} assists={[{ playerName: "Assist player", teamNames: "Team B", total: 3 }]} />);
    for (const player of scorers) expect(html).toContain(player.playerName);
    expect(html).toContain("Assist player");
    expect(html).toContain("repeat(2, minmax(0, 1fr))");
    expect(html).not.toContain("Top scorers");
    expect(html).not.toContain("Top assists");
  });

  it("keeps result scores, home/away, goal counts, assists and own goals", () => {
    const html = renderToStaticMarkup(<ResultsShareImage session={session} matches={[{ matchNumber: 4, teamAName: "Team A", teamBName: "Team B", teamAScore: 3, teamBScore: 0, homeAway: "Home: Team A | Away: Team B", goals: [{ scorerName: "Rafiul", assistName: "Jahir", goalCount: 2, goalType: "goal" }, { scorerName: "Rocky", assistName: null, goalCount: 1, goalType: "own_goal" }] }]} />);
    for (const value of ["Game 4", "3-0", "Home: Team A", "Away: Team B", "Rafiul", "x2", "Assist: Jahir", "Own goal: ", "Rocky"]) expect(html).toContain(value);
  });

  it("includes all saved roster players and marks captains without skill data", () => {
    const teams = Array.from({ length: 4 }, (_, index) => ({ id: `team-${index}`, name: `Team ${index + 1}`, captainPlayerId: `${index}-7`, players: Array.from({ length: 8 }, (_, player) => ({ id: `${index}-${player}`, name: `Player ${index}-${player}` })) }));
    const html = renderToStaticMarkup(<TeamsShareImage session={session} teams={teams} />);
    for (const team of teams) for (const player of team.players) expect(html).toContain(player.name);
    expect(html.match(/aria-label="Captain"/g)).toHaveLength(4);
    expect(html.indexOf("Player 0-7")).toBeLessThan(html.indexOf("Player 0-0"));
    expect(html).not.toContain("Skill");
  });

  it("handles empty reports without invalid grid dimensions", () => {
    for (const image of [<StandingsShareImage session={session} standings={[]} />, <PlayersShareImage session={session} scorers={[]} assists={[]} />, <ResultsShareImage session={session} matches={[]} />, <TeamsShareImage session={session} teams={[]} />]) {
      const html = renderToStaticMarkup(image);
      expect(html).toContain("No ");
      expect(html).not.toContain("repeat(0");
    }
  });
});

describe("multi-image sharing", () => {
  it("checks the complete file set and shares it exactly once", async () => {
    const files = [new File(["first"], "report-1.png", { type: "image/png" }), new File(["second"], "report-2.png", { type: "image/png" })];
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare });
    expect(canShareImages(files)).toBe(true);
    expect(canShare).toHaveBeenCalledWith({ files });
    expect(await shareImages(files, "Match Results")).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ files, title: "Match Results" });
    expect(imageFileName("Sunday / Football", "Scorers & Assists", "2026-10-04")).toBe("sunday-football-2026-10-04-scorers-assists.png");
  });
});
