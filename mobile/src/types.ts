export type UserRole = "admin" | "captain" | "player";

export type MobileProfile = {
  id: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  playerId: string | null;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
};
