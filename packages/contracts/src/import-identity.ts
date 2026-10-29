export type ImportIdentity = { id: string; display_name: string };
export type ImportAlias = { player_id: string; alias_name: string };

function words(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en").trim().replace(/\s+/g, " ");
}

/** A short name must not win over another person's longer name or alias. */
export function importIdentityCandidates(name: string, players: ImportIdentity[], aliases: ImportAlias[] = []) {
  const key = words(name);
  if (!key) return [];
  const matches = (value: string) => words(value) === key || words(value).startsWith(`${key} `);
  const aliasIds = new Set(aliases.filter(alias => matches(alias.alias_name)).map(alias => alias.player_id));
  return players.filter(player => matches(player.display_name) || aliasIds.has(player.id));
}

export function assertImportIdentitySelections(
  names: string[], players: ImportIdentity[], aliases: ImportAlias[], selections: ReadonlyMap<string, string>
) {
  for (const name of names) {
    const selected = selections.get(name);
    if (selected && !players.some(player => player.id === selected)) {
      throw new Error(`Selected player for "${name}" does not belong to this organization.`);
    }
    if (!selected && importIdentityCandidates(name, players, aliases).length > 1) {
      throw new Error(`Multiple players match "${name}". Select the correct player explicitly before importing.`);
    }
  }
}
