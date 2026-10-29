import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { accountLoadError } from "@ou/contracts";
import { useMobile } from "@ou/mobile-core";
import { Button, Choices, Columns, Field, Metrics, Row, Screen, Section, colors, styles } from "@ou/mobile-ui";

import { Pitch } from "./pitch";
import { formationPositions as template, restorePositions } from "./planning-layout";
import { Save } from "lucide-react-native";

type Team = { id: string; name: string; players: { id: string; name: string }[] };
type Position = { slot: string; label: string; playerId?: string; x: number; y: number; jerseyColor?: string };
const formations = ["2-1-1", "2-2-1", "2-2-2", "3-3-1", "3-3-2", "3-3-3", "4-3-3"];
export function LineupEditor({ sessionId, teams, onBack }: { sessionId: string; teams: Team[]; onBack(): void }) {
  const { client, workspace, context } = useMobile();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [formation, setFormation] = useState("2-2-2");
  const [positions, setPositions] = useState<Position[]>([]);
  const [slot, setSlot] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const team = teams.find(value => value.id === teamId);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    void (async () => {
      try {
        const result = await client.from("session_team_lineups").select("formation,positions")
          .eq("session_id", sessionId).eq("session_team_id", teamId).eq("organization_id", workspace!.organizationId).maybeSingle();
        if (result.error) throw result.error;
        if (active) { setFormation(result.data?.formation || "2-2-2"); setPositions(restorePositions(result.data?.formation || "2-2-2", result.data?.positions ?? [])); setDirty(false); }
      } catch (cause) { if (active) setError(accountLoadError(cause)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [client, workspace?.organizationId, sessionId, teamId, refresh]);
  function navigate(action: () => void) {
    if (dirty) Alert.alert("Discard lineup changes?", "Your changes have not been saved.", [{ text: "Keep editing", style: "cancel" }, { text: "Discard", style: "destructive", onPress: action }]);
    else action();
  }
  async function save() {
    if (lock.current || !team || !workspace || !context) return;
    lock.current = true; setSaving(true); setError("");
    try {
      const result = await client.from("session_team_lineups").upsert({
        organization_id: workspace.organizationId, session_id: sessionId, session_team_id: teamId,
        player_count: 1 + formation.split("-").reduce((sum, value) => sum + Number(value), 0),
        formation, positions: positions.filter(value => value.playerId), created_by: context.profile.id
      }, { onConflict: "session_team_id" });
      if (result.error) throw result.error;
      setDirty(false); Alert.alert("Lineup saved");
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { lock.current = false; setSaving(false); }
  }
  if (slot !== null) return <Screen title={`Assign ${positions[slot]?.label || "position"}`} onBack={() => setSlot(null)}>
    <Text style={styles.title}>{team?.name}</Text>
    <Columns>{(["x","y"] as const).map(axis=><Field key={axis} label={axis==="x"?"Field length (%)":"Field width (%)"} value={String(positions[slot]?.[axis]??0)} keyboardType="number-pad" onChangeText={text=>{if(/^\d{1,3}$/.test(text)&&Number(text)<=100){setPositions(current=>current.map((value,index)=>index===slot?{...value,[axis]:Number(text)}:value));setDirty(true);}}}/>)}</Columns>
    <Section>ASSIGN PLAYER</Section>
    <Row title="Unassigned" onPress={() => { setPositions(current => current.map((value, index) => index === slot ? { ...value, playerId: undefined } : value)); setDirty(true); setSlot(null); }} />
    {team?.players.filter(player => !positions.some((position, index) => index !== slot && position.playerId === player.id)).map(player => <Row key={player.id} title={player.name} onPress={() => { setPositions(current => current.map((value, index) => index === slot ? { ...value, playerId: player.id } : value)); setDirty(true); setSlot(null); }} />)}
  </Screen>;
  return <Screen title="Team lineup" onBack={saving ? undefined : () => navigate(onBack)}>
    <Choices value={teamId} options={teams.map(value => ({ value: value.id, label: value.name }))} disabled={saving || loading} onChange={value => navigate(() => setTeamId(value))} />
    {error ? <><Text style={styles.error}>{error}</Text><Button onPress={() => setRefresh(value => value + 1)}>Retry</Button></> : loading ? <Text style={styles.muted}>Loading lineup...</Text> : <>
      <Choices value={formation} options={formations.map(value => ({ value, label: value }))} disabled={saving} onChange={value => {
        setFormation(value); setPositions(current => template(value).map((position, index) => ({ ...position, playerId: current.filter(row => row.playerId)[index]?.playerId }))); setDirty(true);
      }} />
      <Metrics items={[{label:"On pitch",value:positions.filter(value=>value.playerId).length},{label:"Available",value:team?.players.filter(player=>!positions.some(position=>position.playerId===player.id)).length??0},{label:"Formation",value:formation}]}/>
      <Pitch positions={positions} players={team?.players??[]} selected={null} onSelect={setSlot} disabled={saving}/>
      <Section>SHIRT COLOUR</Section>
      <View style={[styles.horizontal,{flexWrap:"wrap"}]}>{["#FFFFFF","#F3C85B","#E87272","#63B0F2","#B7A0EA"].map(color=><Pressable key={color} accessibilityRole="button" accessibilityLabel={`Use ${color} shirt colour`} disabled={saving} onPress={()=>{setPositions(current=>current.map(position=>({...position,jerseyColor:color})));setDirty(true);}} style={{width:44,height:44,borderRadius:22,backgroundColor:color,borderWidth:positions[0]?.jerseyColor===color?3:1,borderColor:positions[0]?.jerseyColor===color?colors.forest:colors.border}}/>)}</View>
      <Section>POSITIONS</Section>
      {positions.map((position,index)=><Row key={position.slot} title={team?.players.find(player=>player.id===position.playerId)?.name??"Unassigned"} subtitle={position.label || `Position ${index+1}`} onPress={saving?undefined:()=>setSlot(index)}/>)}
      <Section>BENCH</Section>
      {team?.players.filter(player=>!positions.some(position=>position.playerId===player.id)).map(player=><Row key={player.id} title={player.name}/>)}
      {!positions.length ? <Button secondary onPress={() => { setPositions(template(formation)); setDirty(true); }}>Apply formation</Button> : null}
      <Button icon={<Save size={18} color="white"/>} disabled={saving || !dirty} onPress={() => Alert.alert("Save lineup?", `${team?.name}: ${positions.filter(value => value.playerId).length} assigned players, formation ${formation}.`, [{ text: "Cancel", style: "cancel" }, { text: "Save", onPress: () => void save() }])}>{saving ? "Saving..." : "Review lineup"}</Button>
    </>}
  </Screen>;
}
