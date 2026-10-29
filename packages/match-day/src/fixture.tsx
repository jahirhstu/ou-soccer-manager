import { useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { accountLoadError } from "@ou/contracts";
import { useMobile } from "@ou/mobile-core";
import { Badge, Button, Choices, Columns, Field, Metrics, Screen, Section, Segments, colors, styles } from "@ou/mobile-ui";

import { CalendarDays, Clock, Save } from "lucide-react-native";
import { fixturePreview } from "./planning-layout";

export function FixtureGenerator({ sessionId, teams, onBack }: { sessionId: string; teams: { id: string; name: string }[]; onBack(): void }) {
  const { client, workspace } = useMobile();
  const [values, setValues] = useState(["2", "12", "12", "0", "0"]);
  const [avoid, setAvoid] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [visible,setVisible]=useState(8);
  const [stage,setStage]=useState("settings");
  const submission = useRef<{ payload: string; id: string } | null>(null);
  const labels = ["Repeat each matchup", "Game minutes before break", "Game minutes after break", "Break after game (0 for none)", "Break minutes"];
  const valid = values.every((value, i) => /^\d+$/.test(value) && Number(value) >= (i < 3 ? 1 : 0) && Number(value) <= [20,180,180,1000,180][i]);
  const games = teams.length * (teams.length - 1) / 2 * Number(values[0]);
  const preview=valid?fixturePreview(teams,Number(values[0]),avoid):[];
  const totalMinutes=preview.reduce((sum,_,index)=>sum+Number(values[Number(values[3])>0&&index>=Number(values[3])?2:1]),0)+(Number(values[3])>0&&Number(values[3])<games?Number(values[4]):0);
  async function save() {
    if (lock.current || !valid) return;
    lock.current = true; setSaving(true); setError("");
    const payload = JSON.stringify({ values, avoid });
    if (submission.current?.payload !== payload) submission.current = { payload, id: Crypto.randomUUID() };
    try {
      const result = await client.rpc("mobile_generate_fixture", {
        p_program_id: workspace!.programId, p_session_id: sessionId, p_submission_id: submission.current.id,
        p_repeats: Number(values[0]), p_first_minutes: Number(values[1]), p_second_minutes: Number(values[2]),
        p_break_after: Number(values[3]), p_break_minutes: Number(values[4]), p_avoid_team: avoid || null
      });
      if (result.error) throw result.error;
      Alert.alert("Fixture saved", `${result.data.games} games generated.`); onBack();
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { lock.current = false; setSaving(false); }
  }
  return <Screen title="Generate fixture" onBack={saving ? undefined : onBack}>
    <View style={[styles.horizontal,{paddingVertical:6}]}><CalendarDays size={24} color={colors.green}/><View style={{flex:1}}><Text style={styles.title}>Session schedule</Text><Text style={styles.muted}>Round-robin matchups</Text></View><Badge label="Draft"/></View>
    <Metrics items={[{label:"Teams",value:teams.length},{label:"Games",value:valid?games:"-"},{label:"Minutes",value:valid?totalMinutes:"-"}]}/>
    <Segments value={stage} options={[{value:"settings",label:"Settings"},{value:"preview",label:"Preview"}]} onChange={setStage}/>
    {stage==="settings"?<>
    <Section>MATCH SETTINGS</Section>
    <Columns>{labels.map((label, i) => <Field key={label} label={label} keyboardType="number-pad" value={values[i]} editable={!saving} onChangeText={text => setValues(current => current.map((value, index) => index === i ? text : value))} />)}</Columns>
    <Section>REST FIRST</Section>
    <Choices value={avoid} options={[{ value: "", label: "No preference" }, ...teams.map(team => ({ value: team.id, label: team.name }))]} disabled={saving} onChange={setAvoid} />
    {valid ? <Text style={styles.body}>{teams.length} teams / {games} games</Text> : <Text style={styles.error}>Enter valid whole numbers. Matchups: 1–20; game minutes: 1–180; break minutes: 0–180.</Text>}
    <Button disabled={!valid||!preview.length} onPress={()=>setStage("preview")}>Preview fixture</Button></>:null}
    {stage==="preview"&&preview.length?<><View style={[styles.horizontal,{justifyContent:"space-between"}]}><Section>MATCHUP PREVIEW</Section><Text style={styles.muted}>{preview.length} games</Text></View>
    <Text style={styles.muted}>Estimated order. Saved timings use the session start time.</Text>
    {preview.slice(0,visible).map((game,index)=><View key={index} style={{gap:8}}>
      {Number(values[3])>0&&index===Number(values[3])?<View style={[styles.horizontal,{padding:10,backgroundColor:"#FFF4D6",borderRadius:6}]}><Clock size={16} color={colors.gold}/><Text style={[styles.title,{color:colors.gold}]}>{values[4]} minute break</Text></View>:null}
      <View style={{backgroundColor:"white",borderWidth:1,borderColor:colors.border,borderRadius:8,padding:12,gap:10}}>
        <View style={[styles.horizontal,{justifyContent:"space-between"}]}><Text style={[styles.muted,{fontWeight:"700",color:colors.green}]}>G{index+1} / Round {game.round}</Text><Text style={styles.muted}>{Number(values[3])>0&&index>=Number(values[3])?values[2]:values[1]} min</Text></View>
        <View style={styles.horizontal}><View style={{flex:1}}><Text style={styles.title}>{game.home.name}</Text><Text style={styles.muted}>Home</Text></View><Text style={[styles.muted,{fontWeight:"700"}]}>vs</Text><View style={{flex:1,alignItems:"flex-end"}}><Text style={[styles.title,{textAlign:"right"}]}>{game.away.name}</Text><Text style={styles.muted}>Away</Text></View></View>
      </View>
    </View>)}
    {preview.length>visible?<Button secondary onPress={()=>setVisible(value=>value+12)}>More games ({preview.length-visible})</Button>:null}</>:null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {stage==="preview"?<Button icon={<Save size={18} color="white"/>} disabled={saving || !valid || !preview.length} onPress={() => Alert.alert("Replace saved fixture?", `${games} games will replace the existing unplayed fixture. Recorded results cannot be replaced.`, [{ text: "Cancel", style: "cancel" }, { text: "Generate and save", onPress: () => void save() }])}>{saving ? "Saving..." : "Review and save fixture"}</Button>:null}
  </Screen>;
}
