export type DashboardSeason = {
  id: string;
  status: string;
};

// Seasons arrive ordered by start date, creation timestamp, and ID.
export function resolveDashboardSeason<T extends DashboardSeason>(seasons: T[], requestedId?: string): T | undefined {
  return seasons.find((season) => season.id === requestedId)
    ?? seasons.find((season) => season.status === "active")
    ?? seasons[0];
}
