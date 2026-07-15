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

export type MobileOrganization = {
  id: string;
  name: string;
  slug: string;
  role: UserRole;
  playerId: string | null;
};

export type MobileProgram = {
  id: string;
  name: string;
  slug: string;
  category: string;
};
