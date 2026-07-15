import type { FeatureKey } from "../features";

export type RootStackParamList = {
  Home: undefined;
  Sessions: undefined;
  SessionDetail: { sessionId: string };
  Attendance: undefined;
  Notifications: undefined;
  Users: undefined;
  Settings: undefined;
  Feature: { featureKey: FeatureKey };
  CreateRecord: { featureKey: "programs" | "seasons" | "sessions" | "players" | "payments" | "expenses" };
};
