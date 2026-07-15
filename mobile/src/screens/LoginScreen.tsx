import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { colors } from "../theme";

export function LoginScreen() {
  const { signIn, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!email.trim() || !password) return;
    setSubmitting(true);
    try { await signIn(email, password); } catch { /* AuthProvider displays the error. */ }
    finally { setSubmitting(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.page}>
      <View style={styles.logo}><Text style={styles.logoText}>OU</Text></View>
      <Text style={styles.title}>Soccer Manager</Text>
      <Text style={styles.subtitle}>Sign in with the same account you use on the web.</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} style={styles.input} value={email} />
        <Text style={styles.label}>Password</Text>
        <TextInput autoCapitalize="none" onChangeText={setPassword} secureTextEntry style={styles.input} value={password} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable disabled={submitting || !email.trim() || !password} onPress={submit} style={({ pressed }) => [styles.button, pressed && styles.pressed, (submitting || !email.trim() || !password) && styles.disabled]}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: colors.background },
  logo: { alignSelf: "center", width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.pitch },
  logoText: { color: "white", fontSize: 22, fontWeight: "900" },
  title: { marginTop: 18, textAlign: "center", color: colors.ink, fontSize: 28, fontWeight: "800" },
  subtitle: { marginTop: 8, marginBottom: 26, textAlign: "center", color: colors.muted, fontSize: 15 },
  card: { padding: 20, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  label: { marginBottom: 7, color: colors.ink, fontWeight: "700" },
  input: { minHeight: 50, marginBottom: 16, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 12, color: colors.ink, backgroundColor: "white" },
  error: { marginBottom: 14, color: colors.danger },
  button: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.pitch },
  buttonText: { color: "white", fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 }
});
