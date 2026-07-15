import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import { features } from "../features";
import type { RootStackParamList } from "../navigation/types";
import { colors } from "../theme";

export function FeatureScreen({ route }: NativeStackScreenProps<RootStackParamList, "Feature">) {
  const feature = features.find((item) => item.key === route.params.featureKey);
  return <View style={styles.page}><Text style={styles.title}>{feature?.title}</Text><Text style={styles.text}>{feature?.description}</Text></View>;
}

const styles = StyleSheet.create({ page: { flex: 1, padding: 20, backgroundColor: colors.background }, title: { color: colors.ink, fontSize: 26, fontWeight: "900" }, text: { marginTop: 8, color: colors.muted } });
