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
  it("detects duplicate full names but not unrelated prefixes", () => {
    expect(importIdentityCandidates("Ronnie", [...players, { id: "three", display_name: "Ronniel" }])).toHaveLength(2);
    expect(importIdentityCandidates("Ronnie Khan", [players[1], { id: "three", display_name: "Ronnie Khan" }])).toHaveLength(2);
  });
  it("rejects foreign player IDs", () => {
    expect(() => assertImportIdentitySelections(["Ronnie"], players, [], new Map([["Ronnie", "foreign"]]))).toThrow("organization");
  });
});
