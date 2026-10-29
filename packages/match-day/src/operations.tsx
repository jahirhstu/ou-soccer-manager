import { useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { accountLoadError } from "@ou/contracts";
import { Records, useMobile } from "@ou/mobile-core";
import { Badge, Button, Choices, Field, Row, Screen, Section, styles } from "@ou/mobile-ui";
import { CompleteSession } from "./complete-session";

type Player = { id: string; name: string; status: string | null; notes: string };
type Roster = { session: { name: string; date: string; status: string }; rows: Player[]; hasMore: boolean; canComplete: boolean };
export function SessionOperations({ onBack }: { onBack(): void }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  if (!sessionId) return <Records resource="sessions" title="Session operations" onBack={onBack} onSelect={setSessionId} />;
  return <Attendance key={sessionId} sessionId={sessionId} onBack={() => setSessionId(null)} />;
}
export function Attendance({ sessionId, onBack }: { sessionId: string; onBack(): void }) {
  const { client, workspace } = useMobile();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [status, setStatus] = useState("confirmed");
  const [notes, setNotes] = useState("");
  const submission = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    let active = true; setRoster(null); setError("");
    void (async () => {
      try {
        const result = await client.rpc("mobile_session_roster", { p_program_id: workspace!.programId, p_session_id: sessionId, p_offset: offset, p_query: search });
        if (result.error) throw result.error;
        if (active) setRoster(result.data as Roster);
      } catch (cause) { if (active) setError(accountLoadError(cause)); }
    })();
    return () => { active = false; };
  }, [client, workspace?.programId, sessionId, offset, search, refresh]);
  async function save(action: "attendance") {
    if (busy || !roster || !player) return;
    const data = { playerId: player.id, status, notes, expectedStatus: player.status };
    const payload = JSON.stringify({ action, data, sessionId });
    if (submission.current?.payload !== payload) submission.current = { payload, id: Crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      const result = await client.rpc("mobile_session_operation", { p_program_id: workspace!.programId, p_session_id: sessionId, p_action: action, p_data: data, p_submission_id: submission.current!.id });
      if (result.error) throw result.error;
      setPlayer(null); setRefresh((value) => value + 1);
      Alert.alert("Attendance saved");
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { setBusy(false); }
  }
  if (player) return <Screen title={player.name} onBack={busy ? undefined : () => setPlayer(null)}>
    <Text style={styles.muted}>{roster?.session.name} / {roster?.session.date}</Text>
    <Section>ATTENDANCE STATUS</Section>
    <Choices options={["confirmed", "played", "absent", "dropped", "replacement", "waitlisted"].map((value) => ({ value, label: value }))} value={status} disabled={busy} onChange={setStatus} />
    <Field label="Notes" value={notes} onChangeText={setNotes} editable={!busy} multiline maxLength={1000} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Button disabled={busy} onPress={() => Alert.alert("Update attendance?", `${player.name}: ${status}. Session charges will be reconciled using the existing attendance billing rules.`, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => void save("attendance") }])}>{busy ? "Saving..." : "Review attendance"}</Button>
  </Screen>;
  return <Screen title={roster?.session.name ?? "Attendance"} onBack={busy ? undefined : onBack}>
    {roster ? <><Text style={styles.muted}>{roster.session.date}</Text><Badge label={roster.session.status} /></> : null}
    {roster?.canComplete && !busy ? <CompleteSession key={sessionId} sessionId={sessionId} status={roster.session.status} onCompleted={() => setRefresh(value => value + 1)} /> : null}
    <Field label="Search program players" value={query} onChangeText={setQuery} maxLength={100} />
    <Button secondary disabled={busy} onPress={() => { setOffset(0); setSearch(query.trim()); }}>Search</Button>
    {error ? <><Text style={styles.error}>{error}</Text><Button onPress={() => setRefresh((value) => value + 1)}>Retry</Button></> : !roster ? <Text style={styles.muted}>Loading attendance...</Text> : null}
    {roster?.rows.map((row) => <Row key={row.id} title={row.name} subtitle={row.status ?? "Not registered"} detail={row.notes} onPress={busy || roster.session.status === "cancelled" ? undefined : () => { setPlayer(row); setStatus(row.status ?? "confirmed"); setNotes(row.notes); setError(""); }} />)}
    {roster && !roster.rows.length ? <Text style={styles.muted}>No matching players.</Text> : null}
    <View style={styles.horizontal}><Button secondary disabled={!roster || busy || offset === 0} onPress={() => setOffset(offset - 25)}>Previous</Button><Button secondary disabled={!roster?.hasMore || busy} onPress={() => setOffset(offset + 25)}>Next</Button></View>
  </Screen>;
}
