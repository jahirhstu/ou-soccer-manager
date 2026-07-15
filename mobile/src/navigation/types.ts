import type { FeatureKey } from "../features";

export type RootStackParamList = {
  Home: undefined;
  Sessions: undefined;
  SessionDetail: { sessionId: string };
  Fixture: { sessionId: string };
  Scores: { sessionId: string };
  VoiceScores: { sessionId: string };
  Teams: { sessionId: string };
  Lineups: { sessionId: string };
  Attendance: undefined;
  Notifications: undefined;
  Users: undefined;
  Settings: undefined;
  Performance: undefined;
  Leagues: undefined;
  LeagueDetail: { leagueId: string };
  WhatsAppImport: undefined;
  Reminders: undefined;
  Waiver: undefined;
  MyStatus: undefined;
  Feature: { featureKey: FeatureKey };
  CreateRecord: { featureKey: "programs" | "seasons" | "sessions" | "players" | "payments" | "expenses" };
};
