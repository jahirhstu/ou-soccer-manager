import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { accountLoadError, balancedDraftRounds } from "@ou/contracts";
import { useMobile } from "@ou/mobile-core";
import { Badge, Button, Columns, Field, Metrics, Row, Screen, Section, Segments, colors, styles } from "@ou/mobile-ui";

import { Crown, Plus, Save, Settings2, Trash2, X } from "lucide-react-native";
import { CaptainDraw, teamColors } from "./captain-draw";

type Player = { id: string; name: string; status: string };
type Team = { key?: string; id?: string; name: string; captainPlayerId?: string; playerIds: string[] };
type Planning = { players: Player[]; teams: { id: string; name: string; captainPlayerId?: string; players: Player[] }[]; settings: { playersPerTeam?: number }; draft?: { teams: Team[]; playersPerTeam: number; draftMode: string; tossOrderKeys?: string[] } | null };

export function TeamBuilder({ sessionId, onBack }: { sessionId: string; onBack(): void }) {
  const { client, workspace } = useMobile();
  const [data, setData] = useState<Planning | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [capacity, setCapacity] = useState("7");
  const [selected, setSelected] = useState(0);
  const [picker, setPicker] = useState<"captain" | "player" | null>(null);
  const [error, setError] = useState("");
  const [persisting, setSaving] = useState(false);
  const [drawing,setDrawing]=useState(false);
  const saving=persisting||drawing;
  const [dirty, setDirty] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [mode, setMode] = useState("lottery");
  const [order, setOrder] = useState<number[]>([]);
  const lock = useRef(false);
  const {fontScale}=useWindowDimensions();
  const [query,setQuery]=useState("");
  const [settings,setSettings]=useState(false);
  const [drawOpen,setDrawOpen]=useState(true);
  const [remoteUpdate,setRemoteUpdate]=useState(false);
  const [connected,setConnected]=useState(false);
  useEffect(()=>{
    const channel=client.channel(`native-team-updates-${sessionId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"session_team_update_events",filter:`session_id=eq.${sessionId}`},()=>setRemoteUpdate(true))
      .subscribe(status=>setConnected(status==="SUBSCRIBED"));
    return ()=>{void client.removeChannel(channel);};
  },[client,sessionId]);
  useEffect(() => {
    let active = true; setData(null); setError("");
    void (async () => {
      try {
        const result = await client.rpc("mobile_session_planning", { p_program_id: workspace!.programId, p_session_id: sessionId });
        if (result.error) throw result.error;
        const value = result.data as Planning;
        if (active) {
          const initial=value.draft?.teams?.length?value.draft.teams:value.teams.length ? value.teams.map(team => ({ key: team.id, id: team.id, name: team.name, captainPlayerId: team.captainPlayerId, playerIds: team.players.map(player => player.id) })) : [1,2,3].map(n => ({ key: `team-${n}`, name: `Team ${n}`, playerIds: [] }));
          setData(value); setTeams(initial);
          setCapacity(String(value.draft?.playersPerTeam || value.settings.playersPerTeam || 7)); setMode(value.draft?.draftMode || "lottery");
          setOrder((value.draft?.tossOrderKeys??[]).map(key=>initial.findIndex(team=>team.key===key)).filter(index=>index>=0));setDirty(false);
        }
      } catch (cause) { if (active) setError(accountLoadError(cause)); }
    })();
    return () => { active = false; };
  }, [client, workspace?.programId, sessionId, refresh]);
  const players = Array.from(new Map([...(data?.players ?? []).filter(player=>player.status!=="waitlisted"), ...(data?.teams.flatMap(team => team.players) ?? [])].map(player => [player.id, player])).values());
  const team = teams[selected];
  const effectiveOrder=order.length===teams.length?order:[];
  const picked=teams.reduce((sum,value)=>sum+value.playerIds.filter(id=>id!==value.captainPlayerId).length,0);
  const rounds=effectiveOrder.length && effectiveOrder.length<=6?balancedDraftRounds(effectiveOrder.map(index=>({key:String(index),index})),30):[];
  const turn=rounds.flat()[picked]?.index;
  function change(update: (value: Team) => Team) {
    setTeams(current => current.map((value, index) => index === selected ? update(value) : value)); setDirty(true);
  }
  function leave() {
    if (!dirty) onBack();
    else Alert.alert("Discard team changes?", "Your changes have not been saved.", [{ text: "Keep editing", style: "cancel" }, { text: "Discard", style: "destructive", onPress: onBack }]);
  }
  async function saveDraft() {
    if(lock.current) return;
    if(!/^\d+$/.test(capacity) || Number(capacity)<1 || Number(capacity)>30) {setError("Players per team must be between 1 and 30.");return;}
    lock.current=true;setSaving(true);setError("");
    try {
      const result=await client.rpc("save_program_team_builder_draft",{
        p_session_id:sessionId,p_teams:teams.map((value,index)=>({...value,key:value.key??String(index)})),p_players_per_team:Number(capacity),
        p_draft_mode:mode,p_pick_cursor:picked,p_toss_order_keys:effectiveOrder.length?effectiveOrder.map(index=>teams[index].key??String(index)):null,p_roulette_rotation:0
      });
      if(result.error) throw result.error;
      setDirty(false);Alert.alert("Draft saved", "Saved teams have not been changed.");
    } catch(cause) {setError(accountLoadError(cause));}
    finally {lock.current=false;setSaving(false);}
  }
  async function save() {
    if (lock.current) return;
    if (!/^\d+$/.test(capacity) || Number(capacity)<1 || Number(capacity)>30 || teams.length<2 || teams.some(value => !value.name.trim() || !value.captainPlayerId || !value.playerIds.includes(value.captainPlayerId) || value.playerIds.length>Number(capacity))) {
      setError("Choose a captain for each team, enter team names, and keep each team within its capacity (1–30)."); return;
    }
    if (new Set(teams.map(value => value.name.trim().toLowerCase())).size!==teams.length) { setError("Team names must be distinct."); return; }
    lock.current=true; setSaving(true); setError("");
    try {
      const result = await client.rpc("save_program_team_builder", { p_session_id: sessionId, p_players_per_team: Number(capacity), p_teams: teams });
      if (result.error) throw result.error;
      setDirty(false); Alert.alert("Teams saved"); onBack();
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { lock.current=false; setSaving(false); }
  }
  const pool=players.filter(player=>!teams.some(value=>value.playerIds.includes(player.id)));
  function assign(id:string) {
    if(saving||!team)return;
    if(!/^\d+$/.test(capacity)||Number(capacity)<1||team.playerIds.length>=Number(capacity)){setError("Set a valid capacity with an open team place.");return;}
    change(value=>({...value,playerIds:[...value.playerIds,id]}));
  }
  function remove(index:number,id:string) {
    Alert.alert("Return player to draft pool?",players.find(player=>player.id===id)?.name,[{text:"Cancel",style:"cancel"},{text:"Remove",style:"destructive",onPress:()=>{
      setTeams(current=>current.map((value,i)=>i===index?{...value,playerIds:value.playerIds.filter(playerId=>playerId!==id),captainPlayerId:value.captainPlayerId===id?undefined:value.captainPlayerId}:value));setDirty(true);
    }}]);
  }
  if (picker && team) return <Screen title={picker === "captain" ? "Select captain" : "Add player"} onBack={() => setPicker(null)}>
    {players.filter(player => !teams.some((value, index) => (index !== selected || picker === "player") && value.playerIds.includes(player.id))).map(player => <Row key={player.id} title={player.name} subtitle={player.status} onPress={() => {
      if (!team.playerIds.includes(player.id) && team.playerIds.length>=Number(capacity)) { Alert.alert("Team is full"); return; }
      change(value => ({ ...value, ...(picker === "captain" ? { captainPlayerId: player.id } : {}), playerIds: Array.from(new Set([...value.playerIds, player.id])) })); setPicker(null);
    }} />)}
  </Screen>;
  return <Screen title="Build teams" onBack={saving ? undefined : leave}>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {!data ? <><Text style={styles.muted}>{error ? "Team data unavailable." : "Loading players..."}</Text>{error ? <Button onPress={() => setRefresh(value => value+1)}>Retry</Button> : null}</> : <>
      <View style={[styles.horizontal,{justifyContent:"space-between"}]}><Badge label={dirty?"Unsaved draft":"No unsaved changes"}/><Text style={styles.muted}>{connected?"Updates connected":"Updates offline"}</Text></View>
      {remoteUpdate?<Button secondary disabled={saving} onPress={()=>{const load=()=>{setRemoteUpdate(false);setRefresh(value=>value+1);};if(dirty)Alert.alert("Load updated teams?","Your unsaved edits will be discarded.",[{text:"Keep editing",style:"cancel"},{text:"Load latest",onPress:load}]);else load();}}>Saved teams changed. Load latest</Button>:null}
      <Segments value={mode} options={[{value:"lottery",label:"Lottery"},{value:"balanced",label:"Balanced"}]} onChange={value=>{if(!saving){setMode(value);setDirty(true);}}}/>
      <Pressable accessibilityRole="button" accessibilityState={{expanded:drawOpen}} onPress={()=>setDrawOpen(value=>!value)} disabled={drawing} style={[styles.horizontal,{minHeight:44,justifyContent:"space-between"}]}><Text style={styles.title}>Captain draw</Text><Text style={[styles.muted,{color:colors.green}]}>{drawOpen?"Hide":"Show"}</Text></Pressable>
      {drawOpen?<View style={[styles.horizontal,{alignItems:"center",flexWrap:"wrap"}]}>
        <CaptainDraw onBusy={setDrawing} teams={teams} disabled={saving||teams.some(value=>!value.captainPlayerId)||(mode==="balanced"&&picked>0)} onDraw={next=>{setOrder(next);setSelected(next[0]);setDirty(true);setDrawOpen(false);}}/>
        <View style={{flex:1,minWidth:90,gap:8}}><Section>PICK ORDER</Section>{(effectiveOrder.length?effectiveOrder:teams.map((_,index)=>index)).map((index,rank)=><View key={index} style={styles.horizontal}><View style={{width:26,height:26,borderRadius:13,backgroundColor:teamColors[index%6],alignItems:"center",justifyContent:"center"}}><Text style={{color:"white",fontSize:12,fontWeight:"700"}}>{effectiveOrder.length?rank+1:index+1}</Text></View><Text style={[styles.title,{flex:1}]}>{teams[index].name}</Text></View>)}{!effectiveOrder.length?<Text style={styles.muted}>Order not drawn</Text>:null}</View>
      </View>:effectiveOrder.length?<Text style={styles.muted}>{effectiveOrder.map((index,rank)=>`${rank+1}. ${teams[index].name}`).join(" / ")}</Text>:null}
      <Metrics items={[{label:"Players",value:players.length},{label:"Draft pool",value:pool.length},{label:"Teams",value:teams.length}]}/>
      <Pressable accessibilityRole="button" accessibilityState={{expanded:settings}} onPress={()=>setSettings(value=>!value)} style={[styles.horizontal,{minHeight:44}]}><Settings2 size={18} color={colors.green}/><Text style={styles.title}>Team settings</Text></Pressable>
      {settings?<><Columns><Field label="Players per team" value={capacity} keyboardType="number-pad" maxLength={2} editable={!saving} onChangeText={value=>{setCapacity(value);setDirty(true);}}/><Field label="Selected team name" value={team.name} editable={!saving} onChangeText={name=>change(value=>({...value,name}))}/></Columns>
      <Columns><Button secondary icon={<Plus size={18} color={colors.ink}/>} disabled={saving||teams.length>=6} onPress={()=>{setTeams(current=>[...current,{key:`team-${Date.now()}`,name:`Team ${current.length+1}`,playerIds:[]}]);setSelected(teams.length);setOrder([]);setDirty(true);}}>Add team</Button><Button secondary icon={<Trash2 size={18} color={colors.error}/>} disabled={saving||teams.length<=2||Boolean(team.id)} onPress={()=>Alert.alert("Remove team?", "Its players will return to the draft pool.",[{text:"Cancel",style:"cancel"},{text:"Remove",style:"destructive",onPress:()=>{setTeams(current=>current.filter((_,i)=>i!==selected));setSelected(0);setOrder([]);setDirty(true);}}])}>Remove team</Button></Columns></>:null}
      <View style={[styles.horizontal,{justifyContent:"space-between"}]}><Section>TEAMS</Section>{mode==="balanced"&&turn!==undefined?<Pressable accessibilityRole="button" onPress={()=>setSelected(turn)} style={{minHeight:44,justifyContent:"center",flexShrink:1}}><Text style={[styles.muted,{color:colors.green}]}>Next: {teams[turn]?.name}</Text></Pressable>:null}</View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{gap:10,paddingBottom:8}}>
        {teams.map((value,index)=><View key={value.key??value.id??index} style={{width:fontScale>1.3?260:170,borderWidth:selected===index?2:1,borderColor:selected===index?teamColors[index%6]:colors.border,borderRadius:8,backgroundColor:"white",overflow:"hidden"}}>
          <Pressable accessibilityRole="button" accessibilityState={{selected:selected===index}} onPress={()=>setSelected(index)} style={{padding:10,gap:4,minHeight:60,backgroundColor:selected===index?colors.soft:"#F8FAF9",borderTopWidth:3,borderColor:teamColors[index%6]}}><Text style={styles.title}>{value.name}</Text><Text style={styles.muted}>{value.playerIds.length} / {capacity} players{selected===index?" / Selected":""}</Text></Pressable>
          <View style={{flexDirection:"row",alignItems:"center",paddingLeft:8,minHeight:48}}><Pressable accessibilityRole="button" accessibilityLabel={`Choose captain for ${value.name}`} disabled={saving} onPress={()=>{setSelected(index);setPicker("captain");}} style={{minHeight:48,flex:1,flexDirection:"row",gap:6,alignItems:"center"}}><Crown size={16} color={colors.gold}/><Text style={[styles.muted,{flex:1,color:colors.ink}]}>{players.find(player=>player.id===value.captainPlayerId)?.name??"Choose captain"}</Text></Pressable>{value.captainPlayerId?<Pressable accessibilityRole="button" accessibilityLabel={`Remove captain from ${value.name}`} disabled={saving} onPress={()=>remove(index,value.captainPlayerId!)} style={{width:44,minHeight:44,alignItems:"center",justifyContent:"center"}}><X size={16} color={colors.muted}/></Pressable>:null}</View>
          {value.playerIds.filter(id=>id!==value.captainPlayerId).map(id=><View key={id} style={{marginHorizontal:8,borderTopWidth:1,borderColor:colors.border,flexDirection:"row",alignItems:"center",minHeight:44}}><Text style={[styles.body,{flex:1}]}>{players.find(player=>player.id===id)?.name??"Unknown player"}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${players.find(player=>player.id===id)?.name}`} disabled={saving} onPress={()=>remove(index,id)} style={{width:44,minHeight:44,alignItems:"center",justifyContent:"center"}}><X size={16} color={colors.muted}/></Pressable></View>)}
        </View>)}
      </ScrollView>
      <Section>DRAFT POOL</Section>
      <Text style={[styles.title,{color:colors.green}]}>Assign to {team.name}</Text>
      <Field label="Find player" value={query} onChangeText={setQuery} autoCapitalize="none"/>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:8}}>{pool.filter(player=>player.name.toLowerCase().includes(query.toLowerCase())).map(player=><Pressable key={player.id} accessibilityRole="button" accessibilityLabel={`Assign ${player.name} to ${team.name}`} disabled={saving||team.playerIds.length>=Number(capacity)} onPress={()=>assign(player.id)} style={{flexBasis:fontScale>1.3?"100%":"47%",flexGrow:1,minHeight:48,padding:8,borderWidth:1,borderColor:colors.border,borderRadius:6,backgroundColor:"white",flexDirection:"row",alignItems:"center",gap:6}}><Text style={[styles.body,{flex:1}]}>{player.name}</Text><Plus size={17} color={colors.green}/></Pressable>)}</View>
      {!pool.length?<Text style={styles.muted}>All players assigned.</Text>:null}
      <Button secondary icon={<Save size={18} color={colors.green}/>} disabled={saving || !dirty} onPress={()=>void saveDraft()}>Save draft</Button>
      <Button disabled={saving} onPress={() => Alert.alert("Save teams?", teams.map(value=>`${value.name}: ${value.playerIds.length} players`).join("\n"),[{text:"Cancel",style:"cancel"},{text:"Save",onPress:()=>void save()}])}>{drawing ? "Drawing order..." : persisting ? "Saving..." : "Review teams"}</Button>
    </>}
  </Screen>;
}
