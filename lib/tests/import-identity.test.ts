import { describe, expect, it } from "vitest";
import { assertImportIdentitySelections, importIdentityCandidates } from "../../packages/contracts/src/import-identity";

const players = [{ id: "one", display_name: "Ronnie" }, { id: "two", display_name: "Ronnie Khan" }];
describe("import identity ambiguity", () => {
  it("does not let an exact short name hide another player", () => {
    expect(importIdentityCandidates("  RONNIE  ", players)).toHaveLength(2);
    expect(() => assertImportIdentitySelections(["Ronnie"], players, [], new Map())).toThrow("Select the correct player");
  });
  it("accepts explicit selection and an unambiguous full name", () => {
    expect(() => assertImportIdentitySelections(["Ronnie"], players, [], new Map([["Ronnie", "two"]]))).not.toThrow();
    expect(importIdentityCandidates("Ronnie Khan", players)).toEqual([players[1]]);
  });
  it("checks aliases without double counting a person", () => {
    expect(importIdentityCandidates("Ronnie", players, [{ player_id: "one", alias_name: "Ronnie" }])).toHaveLength(2);
    expect(importIdentityCandidates("Ronnie", [players[0], { id: "two", display_name: "Ronaldo" }], [{ player_id: "two", alias_name: "Ronnie" }])).toHaveLength(2);
  });
  it("detects partial-word matches and duplicate full names", () => {
    expect(importIdentityCandidates("Ronnie", [...players, { id: "three", display_name: "Ronniel" }])).toHaveLength(3);
    expect(importIdentityCandidates("Ronnie Khan", [players[1], { id: "three", display_name: "Ronnie Khan" }])).toHaveLength(2);
  });
  it("requires selection for Rafi but accepts the unique full name Rafiul", () => {
    const names = [{ id: "rafi", display_name: "Rafi" }, { id: "rafiul", display_name: "Rafiul" }];
    expect(importIdentityCandidates("  RAFI  ", names)).toEqual(names);
    expect(() => assertImportIdentitySelections(["Rafi"], names, [], new Map())).toThrow("Select the correct player");
    expect(() => assertImportIdentitySelections(["Rafi"], names, [], new Map([["Rafi", "rafi"]]))).not.toThrow();
    expect(importIdentityCandidates("Rafiul", names)).toEqual([names[1]]);
    expect(() => assertImportIdentitySelections(["Rafiul"], names, [], new Map())).not.toThrow();
  });
  it("finds incoming names anywhere in player names and aliases", () => {
    const names = [{ id: "rafi", display_name: "Rafi" }, { id: "other", display_name: "Md Rafi Ahmed" }];
    expect(importIdentityCandidates("rafi", names)).toEqual(names);
    expect(importIdentityCandidates("rafi", [names[0], { id: "other", display_name: "Ahmed" }], [
      { player_id: "other", alias_name: "Md Rafiul" }
    ])).toHaveLength(2);
  });
  it("does not count matching aliases as additional players", () => {
    expect(importIdentityCandidates("rafi", [{ id: "one", display_name: "Rafiul" }], [
      { player_id: "one", alias_name: "Rafi" },
      { player_id: "one", alias_name: "Md Rafi" }
    ])).toHaveLength(1);
    expect(importIdentityCandidates("   ", players)).toEqual([]);
  });
  it("rejects foreign player IDs", () => {
    expect(() => assertImportIdentitySelections(["Ronnie"], players, [], new Map([["Ronnie", "foreign"]]))).toThrow("organization");
  });
});
