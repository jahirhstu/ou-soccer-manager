import { useRef, useState } from "react";
import { Alert, Text } from "react-native";
import * as Crypto from "expo-crypto";
import { Records, useMobile } from "@ou/mobile-core";
import { Button, Field, Row, Screen, SummaryLine, styles } from "@ou/mobile-ui";
export type CreateKind = "season" | "session" | "player";
export function CreateRecord({ kind, onBack }: { kind: CreateKind; onBack(): void }) {
  const { client, workspace } = useMobile();
  const [values, setValues] = useState<Record<string, string>>({ price: "0.00", sessions: "1", startTime: "07:00", endTime: "09:00" });
  const [chooseSeason, setChooseSeason] = useState(false);
  const [seasonName, setSeasonName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const submission = useRef<{ payload: string; id: string } | null>(null);
  if (chooseSeason) return <Records resource="seasons" title="Select season" onBack={() => setChooseSeason(false)} onSelect={(id, row) => { setValues((current) => ({ ...current, seasonId: id })); setSeasonName(row.title); setChooseSeason(false); }} />;
  const fields = kind === "player" ? [["name", "Full name"], ["email", "Email (optional)"], ["phone", "Phone (optional)"]] :
    kind === "season" ? [["name", "Season name"], ["startDate", "Start date (YYYY-MM-DD)"], ["endDate", "End date (YYYY-MM-DD)"], ["price", "Price per session"], ["sessions", "Planned sessions"]] :
      [["name", "Session name"], ["date", "Date (YYYY-MM-DD)"], ["startTime", "Start time (HH:MM)"], ["endTime", "End time (HH:MM)"], ["price", "Price per player"], ["location", "Field / location"]];
  async function save() {
    if (pending) return;
    if (!values.name?.trim()) { setError("Name is required."); return; }
    const payload = JSON.stringify(values);
    if (submission.current?.payload !== payload) submission.current = { payload, id: Crypto.randomUUID() };
    setPending(true); setError("");
    try {
      const result = await client.rpc("mobile_create_record", { p_program_id: workspace!.programId, p_kind: kind, p_id: submission.current!.id, p_data: values });
      if (result.error) throw result.error;
      Alert.alert("Created"); onBack();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create record. Check all fields."); }
    finally { setPending(false); }
  }
  if (review) return <Screen title={`Review ${kind}`} onBack={pending ? undefined : () => setReview(false)}>
    <SummaryLine label="Program" value={workspace!.programName} />
    {kind === "session" ? <SummaryLine label="Season" value={seasonName} /> : null}
    {fields.map(([key, label]) => <SummaryLine key={key} label={label} value={values[key] || "Not provided"} />)}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Button disabled={pending} onPress={() => void save()}>{pending ? "Saving..." : `Create ${kind}`}</Button>
    <Button secondary disabled={pending} onPress={() => setReview(false)}>Edit details</Button>
  </Screen>;
  return <Screen title={`New ${kind}`} onBack={pending ? undefined : onBack}>
    {kind === "session" ? <Row title="Season" subtitle={seasonName || "Select season"} onPress={pending ? undefined : () => setChooseSeason(true)} /> : null}
    {fields.map(([key, label]) => <Field key={key} label={label} value={values[key] ?? ""} editable={!pending}
      keyboardType={key === "price" ? "decimal-pad" : key === "sessions" ? "number-pad" : key === "email" ? "email-address" : key === "phone" ? "phone-pad" : "default"}
      onChangeText={(value) => setValues((current) => ({ ...current, [key]: value }))} />)}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Button disabled={pending || !values.name?.trim() || (kind === "session" && !values.seasonId)} onPress={() => setReview(true)}>Review {kind}</Button>
  </Screen>;
}
