import type { FeatureKey } from "../features";

export type RootStackParamList = {
  Home: undefined;
  Sessions: undefined;
  SessionDetail: { sessionId: string };
  Attendance: undefined;
  Feature: { featureKey: FeatureKey };
};
