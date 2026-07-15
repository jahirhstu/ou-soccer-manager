import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/auth/AuthProvider";
import { HomeScreen } from "./src/screens/HomeScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { colors } from "./src/theme";

function AppContent() {
  const { loading, session, profile, error } = useAuth();
  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.pitch} size="large" /></View>;
  if (!session) return <LoginScreen />;
  if (!profile) return <View style={styles.center}><Text style={styles.error}>{error ?? "Your account is not connected to an organization."}</Text></View>;
  return <AppNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
        <StatusBar style="dark" />
        <AuthProvider><AppContent /></AuthProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background },
  error: { color: colors.danger, textAlign: "center" }
});
