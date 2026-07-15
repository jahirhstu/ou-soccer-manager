import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen";
import { SessionsScreen } from "../screens/SessionsScreen";
import { SessionDetailScreen } from "../screens/SessionDetailScreen";
import { AttendanceScreen } from "../screens/AttendanceScreen";
import { FeatureScreen } from "../screens/FeatureScreen";
import { CreateRecordScreen } from "../screens/CreateRecordScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { UsersScreen } from "../screens/UsersScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { FixtureScreen } from "../screens/FixtureScreen";
import { ScoresScreen } from "../screens/ScoresScreen";
import { TeamsScreen } from "../screens/TeamsScreen";
import { LineupsScreen } from "../screens/LineupsScreen";
import { colors } from "../theme";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background, card: colors.surface, border: colors.line, primary: colors.pitch, text: colors.ink }
};

export function AppNavigator() {
  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator screenOptions={{ headerBackButtonDisplayMode: "minimal", headerTintColor: colors.pitch, headerTitleStyle: { color: colors.ink, fontWeight: "800" } }}>
        <Stack.Screen component={HomeScreen} name="Home" options={{ headerShown: false }} />
        <Stack.Screen component={SessionsScreen} name="Sessions" />
        <Stack.Screen component={SessionDetailScreen} name="SessionDetail" options={{ title: "Session" }} />
        <Stack.Screen component={FixtureScreen} name="Fixture" />
        <Stack.Screen component={ScoresScreen} name="Scores" />
        <Stack.Screen component={TeamsScreen} name="Teams" />
        <Stack.Screen component={LineupsScreen} name="Lineups" />
        <Stack.Screen component={AttendanceScreen} name="Attendance" />
        <Stack.Screen component={NotificationsScreen} name="Notifications" />
        <Stack.Screen component={UsersScreen} name="Users" />
        <Stack.Screen component={SettingsScreen} name="Settings" />
        <Stack.Screen component={FeatureScreen} name="Feature" options={({ route }) => ({ title: route.params.featureKey })} />
        <Stack.Screen component={CreateRecordScreen} name="CreateRecord" options={{ title: "New record" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
