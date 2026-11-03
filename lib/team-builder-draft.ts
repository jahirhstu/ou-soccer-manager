export const draftPositionCategories = [
  "goalkeeper",
  "defender",
  "midfielder",
  "forward",
  "unassigned"
] as const;

export type DraftPositionCategory = typeof draftPositionCategories[number];

export type DraftCategoryPlayer = {
  id: string;
  preferredPosition?: string | null;
};

export function profileDraftCategory(position?: string | null): DraftPositionCategory {
  const normalized = position?.trim().toLowerCase();
  if (normalized === "goalkeeper" || normalized === "defender" || normalized === "midfielder" || normalized === "forward") {
    return normalized;
  }
  return "unassigned";
}

function isDraftPositionCategory(value: unknown): value is DraftPositionCategory {
  return typeof value === "string" && (draftPositionCategories as readonly string[]).includes(value);
}

export function normalizeDraftCategoryOverrides(
  value: unknown,
  players: DraftCategoryPlayer[]
): Record<string, DraftPositionCategory> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const playerIds = new Set(players.map((player) => player.id));
  const overrides: Record<string, DraftPositionCategory> = {};
  for (const [playerId, category] of Object.entries(value)) {
    if (
      playerIds.has(playerId) &&
      isDraftPositionCategory(category) &&
      category !== profileDraftCategory(players.find((player) => player.id === playerId)?.preferredPosition)
    ) {
      overrides[playerId] = category;
    }
  }
  return overrides;
}

export function currentDraftCategory(
  player: DraftCategoryPlayer,
  overrides: Record<string, DraftPositionCategory>
): DraftPositionCategory {
  return overrides[player.id] ?? profileDraftCategory(player.preferredPosition);
}
