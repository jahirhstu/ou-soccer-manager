import type { UserRole } from "./types";

export type FeatureKey =
  | "dashboard" | "programs" | "sessions" | "performance" | "leagues" | "attendance"
  | "leaderboards" | "fieldStats" | "seasons" | "players" | "users" | "payments"
  | "reminders" | "notifications" | "expenses" | "whatsapp" | "paymentReport" | "settings"
  | "myStatus" | "goalsAssists" | "publicSessions" | "publicLeaderboards" | "fieldStatus";

export type Feature = {
  key: FeatureKey;
  title: string;
  description: string;
  roles: UserRole[];
  writableBy?: UserRole[];
  group: "Club" | "Admin" | "Reports";
};

export const features: Feature[] = [
  { key: "dashboard", title: "Dashboard", description: "Club overview", roles: ["admin"], group: "Club" },
  { key: "programs", title: "Programs", description: "Sports and events", roles: ["admin"], writableBy: ["admin"], group: "Club" },
  { key: "sessions", title: "Sessions", description: "Games, teams and scores", roles: ["admin", "captain"], writableBy: ["admin", "captain"], group: "Club" },
  { key: "performance", title: "Performance", description: "Draft ratings", roles: ["admin", "captain"], writableBy: ["admin", "captain"], group: "Club" },
  { key: "leagues", title: "Leagues", description: "Teams and fixtures", roles: ["admin", "captain"], writableBy: ["admin", "captain"], group: "Club" },
  { key: "attendance", title: "Attendance", description: "Player check-ins", roles: ["admin", "captain"], writableBy: ["admin", "captain"], group: "Club" },
  { key: "leaderboards", title: "Leaderboards", description: "Teams and captains", roles: ["admin", "captain"], group: "Club" },
  { key: "fieldStats", title: "Field stats", description: "Statistics by playground", roles: ["admin", "captain"], group: "Club" },
  { key: "seasons", title: "Seasons", description: "Session groups", roles: ["admin"], writableBy: ["admin"], group: "Admin" },
  { key: "players", title: "Players", description: "Profiles and status", roles: ["admin"], writableBy: ["admin"], group: "Admin" },
  { key: "users", title: "Users", description: "Roles and mappings", roles: ["admin"], writableBy: ["admin"], group: "Admin" },
  { key: "payments", title: "Payments", description: "Received amounts", roles: ["admin"], writableBy: ["admin"], group: "Admin" },
  { key: "reminders", title: "Reminders", description: "WhatsApp payment drafts", roles: ["admin"], group: "Admin" },
  { key: "notifications", title: "Notifications", description: "Payment alerts", roles: ["admin"], writableBy: ["admin"], group: "Admin" },
  { key: "expenses", title: "Expenses", description: "Club spending", roles: ["admin"], writableBy: ["admin"], group: "Admin" },
  { key: "whatsapp", title: "WhatsApp import", description: "Parse group updates", roles: ["admin"], writableBy: ["admin"], group: "Admin" },
  { key: "paymentReport", title: "Payments report", description: "Balances and usage", roles: ["admin"], group: "Admin" },
  { key: "settings", title: "Settings", description: "Roles and cleanup", roles: ["admin"], writableBy: ["admin"], group: "Admin" },
  { key: "myStatus", title: "Status", description: "Players and balances", roles: ["admin", "captain", "player"], group: "Reports" },
  { key: "goalsAssists", title: "Goals & Assists", description: "Players and rates", roles: ["player"], group: "Reports" },
  { key: "publicSessions", title: "Sessions", description: "Games and scores", roles: ["player"], group: "Reports" },
  { key: "publicLeaderboards", title: "Leaderboards", description: "Teams and captains", roles: ["player"], group: "Reports" },
  { key: "fieldStatus", title: "Field Status", description: "By playground", roles: ["player"], group: "Reports" }
];

export function visibleFeatures(role: UserRole) {
  return features.filter((feature) => feature.roles.includes(role));
}

export function canOpenFeature(role: UserRole, key: FeatureKey) {
  return features.some((feature) => feature.key === key && feature.roles.includes(role));
}

export function canWriteFeature(role: UserRole, key: FeatureKey) {
  return features.some((feature) => feature.key === key && feature.writableBy?.includes(role));
}
