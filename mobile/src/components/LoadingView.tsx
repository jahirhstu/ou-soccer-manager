import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export function LoadingView({ error }: { error?: string | null }) {
  return (
    <View style={styles.view}>
      {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.pitch} size="large" />}
    </View>
  );
}

const styles = StyleSheet.create({
  view: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background },
  error: { color: colors.danger, textAlign: "center", lineHeight: 21 }
});
