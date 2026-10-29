import { useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { CheckCircle2 } from "lucide-react-native";
import * as Crypto from "expo-crypto";
import { accountLoadError, canCompleteSession } from "@ou/contracts";
import { useMobile } from "@ou/mobile-core";
import { Button, styles } from "@ou/mobile-ui";

export function CompleteSession({ sessionId, status, onCompleted }: {
  sessionId: string; status: string; onCompleted(): void;
}) {
  const { client, workspace } = useMobile();
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const submission = useRef<string | null>(null);
  if (!canCompleteSession(workspace, status) || completed) return null;

  async function complete() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    submission.current ??= Crypto.randomUUID();
    try {
      const result = await client.rpc("mobile_session_operation", {
        p_program_id: workspace!.programId, p_session_id: sessionId,
        p_action: "complete", p_submission_id: submission.current, p_data: {}
      });
      if (result.error) throw result.error;
      setCompleted(true);
      onCompleted();
      Alert.alert("Session completed", "Attendance and session charges have been updated. Scoring is now locked.");
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { pending.current = false; setBusy(false); }
  }

  return <View style={{ gap: 8 }}>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button icon={<CheckCircle2 size={20} color="white" />} disabled={busy} onPress={() => Alert.alert(
      "Mark session as complete?",
      "Confirmed attendance will become played. Missing session charges will be recorded once; existing charges and waivers will be retained. Scoring will be locked. Save all match results before continuing.",
      [{ text: "Cancel", style: "cancel" }, { text: "Complete session", onPress: () => void complete() }]
    )}>{busy ? "Completing session..." : "Mark Session as Complete"}</Button>
  </View>;
}
