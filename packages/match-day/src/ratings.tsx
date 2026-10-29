import { useEffect, useRef, useState } from "react";
import { Alert, Text } from "react-native";
import { accountLoadError } from "@ou/contracts";
import { useMobile } from "@ou/mobile-core";
import { Button, Columns, Field, Row, Screen, styles } from "@ou/mobile-ui";

type Player = { id: string; name: string };
type Rating = { player_id: string; attacking_skill_percent: number | null; defending_skill_percent: number | null; goalkeeping_skill_percent: number | null; notes: string | null };
const fields = ["attacking_skill_percent", "defending_skill_percent", "goalkeeping_skill_percent"] as const;
const labels = ["Attacking (%)", "Defending (%)", "Goalkeeping (%)"];

export function PerformanceRatings({ players, onBack }: { players: Player[]; onBack(): void }) {
  const { client, workspace, context } = useMobile();
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [selected, setSelected] = useState<Player | null>(null);
  const [values, setValues] = useState(["", "", ""]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    void (async () => {
      try {
        const result = await client.from("player_performance_ratings")
          .select("player_id,attacking_skill_percent,defending_skill_percent,goalkeeping_skill_percent,notes")
          .eq("program_id", workspace!.programId).eq("organization_id", workspace!.organizationId);
        if (result.error) throw result.error;
        if (active) setRatings(result.data ?? []);
      } catch (cause) { if (active) setError(accountLoadError(cause)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [client, workspace?.programId, workspace?.organizationId, refresh]);
  async function save() {
    if (lock.current || !selected || !workspace || !context) return;
    if (values.some(value => value !== "" && (!/^\d{1,3}$/.test(value) || Number(value) > 100))) {
      setError("Ratings must be whole numbers from 0 to 100, or blank."); return;
    }
    lock.current = true; setSaving(true); setError("");
    try {
      const scope = { organization_id: workspace.organizationId, program_id: workspace.programId, player_id: selected.id };
      const result = values.every(value => value === "") && !notes.trim()
        ? await client.from("player_performance_ratings").delete().match(scope)
        : await client.from("player_performance_ratings").upsert({ ...scope,
          ...Object.fromEntries(fields.map((field, i) => [field, values[i] === "" ? null : Number(values[i])])),
          notes: notes.trim() || null, created_by: context.profile.id, updated_by: context.profile.id
        }, { onConflict: "program_id,player_id" });
      if (result.error) throw result.error;
      setSelected(null); setRefresh(value => value + 1); Alert.alert("Player ratings saved");
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { lock.current = false; setSaving(false); }
  }
  return <Screen title={selected ? selected.name : "Player performance"} onBack={saving ? undefined : selected ? () => setSelected(null) : onBack}>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {selected ? <>
      <Columns>{fields.map((field, i) => <Field key={field} label={labels[i]} value={values[i]} keyboardType="number-pad" maxLength={3} editable={!saving} onChangeText={text => setValues(current => current.map((value, index) => index === i ? text : value))} />)}</Columns>
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline editable={!saving} />
      <Button disabled={saving} onPress={() => Alert.alert("Save performance ratings?", `${selected.name}\n${labels.map((label, i) => `${label}: ${values[i] || "Not rated"}`).join("\n")}`, [{ text: "Cancel", style: "cancel" }, { text: "Save", onPress: () => void save() }])}>{saving ? "Saving..." : "Review ratings"}</Button>
    </> : loading ? <Text style={styles.muted}>Loading ratings...</Text> : <>
      {error ? <Button onPress={() => setRefresh(value => value + 1)}>Retry</Button> : players.map(player => {
        const rating = ratings.find(row => row.player_id === player.id);
        return <Row key={player.id} title={player.name} subtitle={`Attack ${rating?.attacking_skill_percent ?? "-"} / Defense ${rating?.defending_skill_percent ?? "-"} / Goalkeeping ${rating?.goalkeeping_skill_percent ?? "-"}`} onPress={() => {
          setSelected(player); setValues(fields.map(field => rating?.[field] == null ? "" : String(rating[field]))); setNotes(rating?.notes ?? ""); setError("");
        }} />;
      })}
      {!players.length ? <Text style={styles.muted}>No players in saved teams for this session.</Text> : null}
    </>}
  </Screen>;
}
