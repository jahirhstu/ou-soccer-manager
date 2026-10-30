import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from "react-native";
import { Plus, Minus, Trash2, Save, Users, CalendarDays, ClipboardCheck, ChartNoAxesColumn, LayoutGrid, Settings2, ChevronDown, ChevronUp, Trophy } from "lucide-react-native";
import { accountLoadError, canScore, sessionSummary, type MatchPosition } from "@ou/contracts";
import { MatchPerformance } from "./performance";
import { useMobile } from "@ou/mobile-core";
import { Avatar, Badge, Button, Busy, Choices, Metrics, Row, Screen, Section, Segments, Shortcuts, styles, colors } from "@ou/mobile-ui";
import { Attendance } from "./operations";
import { CompleteSession } from "./complete-session";
import { PerformanceRatings } from "./ratings";
import { LineupEditor } from "./lineup";
import { FixtureGenerator } from "./fixture";
import { TeamBuilder } from "./team-builder";

type Player = { id: string; name: string };
type Team = { id: string; name: string; players: Player[] };
type Goal = { id?: string; scorerId: string; assistPlayerId?: string; concededGoalkeeperId?: string; goalCount: number; goalType: "goal" | "own_goal" };
type Game = {
  id?: string; matchNumber: number; displayOrder?: number; teamAId?: string; teamBId?: string;
  teamASource?: string; teamBSource?: string; matchType?: string; awayTeamId?: string; resultStatus: "scheduled" | "played";
  scheduledStartTime?: string; scheduledEndTime?: string; goals: Goal[];
};
type Payload = { session: { name: string; sessionDate: string; status: string }; teams: Team[]; matches: Game[] };
type Picker = { game: number; goal: number; field: "scorerId" | "assistPlayerId" | "concededGoalkeeperId" };
export function MatchDay({ sessionId, onBack }: { sessionId: string; onBack(): void }) {
  const { client, workspace } = useMobile();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const [data, setData] = useState<Payload | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [tab, setTab] = useState<"games" | "teams" | "summary">("games");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [reload, setReload] = useState(0);
  const [operation, setOperation] = useState<"attendance" | "ratings" | "lineup" | "fixture" | "builder" | "performance" | null>(null);
  const [positions, setPositions] = useState<MatchPosition[]>([]);
  useEffect(() => {
    let active = true;
    setPositions([]);
    void Promise.resolve(client.rpc("session_performance", { p_session_id: sessionId })).then(result => {
      if (!active) return;
      if (result.error) setError(result.error.message);
      else setPositions(result.data?.positions ?? []);
    }).catch(cause => { if (active) setError(accountLoadError(cause)); });
    return () => { active = false; };
  }, [client, sessionId, workspace?.programId, reload]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [standingDetail, setStandingDetail] = useState<string | null>(null);
  const [expandedGame, setExpandedGame] = useState<number | null>(null);
  useEffect(() => {
    let active = true; setData(null); setError(""); setDirty(false);
    void Promise.resolve(client.rpc("mobile_session", { p_program_id: workspace!.programId, p_session_id: sessionId })).then(({ data: result, error: loadError }) => {
      if (!active) return;
      if (loadError) setError(loadError.message);
      else { setData(result as Payload); setGames((result as Payload).matches); }
    }).catch((cause: unknown) => { if (active) setError(accountLoadError(cause)); });
    return () => { active = false; };
  }, [client, workspace?.programId, sessionId, reload]);
  const eligible = canScore(workspace) && data?.session.status === "scheduled";
  const writable = eligible && editing;
  function leave() {
    if (!dirty) onBack();
    else Alert.alert("Discard changes?", "These scores have not been saved.", [{ text: "Keep editing", style: "cancel" }, { text: "Discard", style: "destructive", onPress: onBack }]);
  }
  function update(index: number, change: (game: Game) => Game) {
    if (!writable || saving) return;
    setGames((current) => current.map((game, i) => i === index ? change(game) : game)); setDirty(true);
  }
  function goalUpdate(game: number, goal: number, patch: Partial<Goal>) {
    if (patch.scorerId !== undefined || patch.goalType !== undefined) {
      const next = { ...games[game].goals[goal], ...patch };
      const options = keepers(games[game], next);
      patch = { ...patch, concededGoalkeeperId: options.length === 1 ? options[0].player_id : "" };
    }
    update(game, (entry) => ({ ...entry, resultStatus: "played", goals: entry.goals.map((value, i) => i === goal ? { ...value, ...patch } : value) }));
  }
  function keepers(game: Game, goal: Goal) {
    const scorerTeam = data?.teams.find(t => t.players.some(p => p.id === goal.scorerId))?.id;
    const concedingTeam = goal.goalType === "own_goal" ? scorerTeam : scorerTeam === game.teamAId ? game.teamBId : game.teamAId;
    return positions.filter(p => p.match_id === game.id && p.session_team_id === concedingTeam && p.position === "goalkeeper" && p.participated);
  }
  async function save() {
    if (saving || !writable) return;
    if (games.some((game) => game.goals.some((goal) => !goal.scorerId))) { setError("Select a scorer for every goal."); return; }
    setSaving(true); setError("");
    try {
      const result = await client.rpc("mobile_save_scores", { p_program_id: workspace!.programId, p_session_id: sessionId, p_games: games });
      if (result.error) throw result.error;
      setDirty(false); setEditing(false); Alert.alert("Scores saved"); setReload((value) => value + 1);
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { setSaving(false); }
  }
  if (!data) return error ? <Screen title="Session" onBack={onBack}><Text style={styles.error}>{error}</Text><Button onPress={() => setReload((value) => value + 1)}>Retry</Button></Screen> : <Busy />;
  const teamName = (id?: string) => data.teams.find((team) => team.id === id)?.name ?? "To be decided";
  const playerName = (id?: string) => data.teams.flatMap((team) => team.players).find((player) => player.id === id)?.name;
  const pickerGame = picker ? games[picker.game] : null;
  const pickerPlayers = pickerGame ? data.teams.filter((team) => [pickerGame.teamAId, pickerGame.teamBId].includes(team.id)).flatMap((team) => team.players) : [];
  const summary = sessionSummary(data.teams, data.matches);
  const operator = Boolean(workspace && ["manager", "captain"].includes(workspace.role));
  const closeOperation = () => { setOperation(null); setReload(value => value + 1); };
  const lineupTeams = data.teams.filter(team => team.players.some(player => player.id === workspace?.playerId));
  const canGenerate = operator && workspace?.modules.fixtures !== false && data.session.status === "scheduled" && !data.matches.some(game => game.resultStatus === "played" || game.goals.length);
  const canBuild = operator && workspace?.modules.teams !== false && data.session.status === "scheduled";
  if (operation === "performance") return <MatchPerformance sessionId={sessionId} onBack={closeOperation} />;
  if (operation === "builder" && canBuild) return <TeamBuilder sessionId={sessionId} onBack={closeOperation} />;
  if (operation === "fixture" && canGenerate) return <FixtureGenerator sessionId={sessionId} teams={data.teams} onBack={closeOperation} />;
  if (operation === "lineup" && lineupTeams.length && workspace?.modules.teams !== false) return <LineupEditor sessionId={sessionId} teams={lineupTeams} onBack={closeOperation} />;
  if (operation === "attendance" && operator && workspace?.modules.attendance !== false) return <Attendance sessionId={sessionId} onBack={closeOperation} />;
  if (operation === "ratings" && operator && workspace?.modules.teams !== false) return <PerformanceRatings players={Array.from(new Map(data.teams.flatMap(team => team.players).map(player => [player.id, player])).values())} onBack={closeOperation} />;
  const actions = [
    {title:"Match ratings & votes",icon:Trophy,onPress:()=>setOperation("performance")},
    ...(operator && workspace?.modules.attendance !== false ? [{title:"Attendance",icon:ClipboardCheck,onPress:()=>setOperation("attendance")}] : []),
    ...(operator && workspace?.modules.teams !== false ? [{title:"Draft skill ratings",icon:ChartNoAxesColumn,onPress:()=>setOperation("ratings")}] : []),
    ...(lineupTeams.length && workspace?.modules.teams !== false ? [{title:"Team lineup",icon:LayoutGrid,onPress:()=>setOperation("lineup")}] : []),
    ...(canGenerate ? [{title:"Generate fixture",icon:CalendarDays,onPress:()=>setOperation("fixture")}] : []),
    ...(canBuild ? [{title:"Build teams",icon:Users,onPress:()=>setOperation("builder")}] : [])
  ];
  return <Screen title={data.session.name || data.session.sessionDate} onBack={leave}>
    <View style={[styles.horizontal,{justifyContent:"space-between",flexWrap:"wrap"}]}><Text style={styles.muted}>{data.session.sessionDate}</Text><Badge label={data.session.status}/></View>
    <Metrics items={[{label:"Teams",value:data.teams.length},{label:"Games",value:games.length},{label:"Played",value:summary.played}]}/>
    {!editing && actions.length ? <Pressable accessibilityRole="button" accessibilityState={{expanded:toolsOpen}} onPress={()=>setToolsOpen(value=>!value)} style={[styles.horizontal,{minHeight:44,paddingHorizontal:4}]}><Settings2 size={18} color={colors.green}/><Text style={[styles.title,{flex:1}]}>Session actions</Text>{toolsOpen?<ChevronUp size={18} color={colors.muted}/>:<ChevronDown size={18} color={colors.muted}/>}</Pressable> : null}
    {!editing && toolsOpen ? <><Shortcuts items={actions}/>{!dirty?<CompleteSession key={sessionId} sessionId={sessionId} status={data.session.status} onCompleted={() => setReload(value => value + 1)} />:null}</>:null}
    {eligible && !editing ? <Button icon={<Plus size={18} color="white"/>} onPress={() => setEditing(true)}>Record or update results</Button> : null}
    <Segments options={[{ value: "games", label: "Games" }, { value: "teams", label: "Teams" }, { value: "summary", label: "Summary" }]} value={tab} onChange={(value) => setTab(value as "games" | "teams" | "summary")} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {tab === "summary" ? <>
      {dirty ? <Text style={styles.muted}>Summary shows saved results. Save score changes to update it.</Text> : null}
      <Section>PODIUM</Section>
      {summary.played ? <View style={styles.grid}>{summary.standings.slice(0,3).map(team=><View key={team.teamId} style={[styles.card,{flexGrow:1,flexBasis:largeText ? "100%" : "29%",minWidth:0,padding:10,alignItems:"center",backgroundColor:team.rank===1?colors.forest:"white"}]}><Trophy size={20} color={team.rank===1?"#EED588":colors.muted}/><Text style={[styles.muted,{color:team.rank===1?"#C9DFD3":colors.muted}]}>{team.rank===1&&data.session.status==="completed"?"Winner":`Place ${team.rank}`}</Text><Text style={[styles.title,{textAlign:"center",color:team.rank===1?"white":colors.ink}]}>{team.teamName}</Text><Text style={{fontSize:24,fontWeight:"700",color:team.rank===1?"white":colors.ink,fontVariant:["tabular-nums"]}}>{team.points}</Text><Text style={[styles.muted,{color:team.rank===1?"#C9DFD3":colors.muted}]}>points</Text></View>)}</View> : <Text style={styles.muted}>No played results yet.</Text>}
      <Section>STANDINGS</Section>
      <View style={{backgroundColor:"white",borderRadius:8,borderWidth:1,borderColor:colors.border,paddingHorizontal:12}}>
        <View style={[styles.horizontal,{paddingVertical:10}]}><Text style={[styles.muted,{flex:1}]}>Team</Text>{["P","GD","Pts"].map(label=><Text key={label} style={[styles.muted,{width:34 * Math.min(fontScale, 2),textAlign:"center"}]}>{label}</Text>)}</View>
        {summary.standings.map(team=>largeText ? <Row key={team.teamId} title={`${team.rank}. ${team.teamName}`} subtitle={`${team.played} played / ${team.goalDifference} GD / ${team.points} points`} detail={`${team.wins} wins / ${team.draws} draws / ${team.losses} losses / GF ${team.goalsFor} / GA ${team.goalsAgainst} / Away goals ${team.awayGoals}`} /> : <View key={team.teamId}><Pressable accessibilityRole="button" accessibilityLabel={`${team.teamName}, ${team.played} played, goal difference ${team.goalDifference}, ${team.points} points. Show details.`} accessibilityState={{expanded:standingDetail===team.teamId}} onPress={()=>setStandingDetail(current=>current===team.teamId?null:team.teamId)} style={[styles.row,styles.horizontal]}><Text style={[styles.title,{flex:1}]}>{team.rank}. {team.teamName}</Text>{[team.played,team.goalDifference,team.points].map((value,index)=><Text key={index} style={[styles.title,{width:34,textAlign:"center",fontVariant:["tabular-nums"],color:index===2?colors.green:colors.ink}]}>{value}</Text>)}</Pressable>{standingDetail===team.teamId?<Text style={[styles.muted,{paddingVertical:8}]}>{team.wins} wins / {team.draws} draws / {team.losses} losses / GF {team.goalsFor} / GA {team.goalsAgainst} / Away goals {team.awayGoals}</Text>:null}</View>)}
      </View>
      <Section>SCORERS AND ASSISTS</Section>
      {summary.contributions.length ? <View><View style={styles.horizontal}><Text style={[styles.muted,{flex:1}]}>Player</Text><Text style={[styles.muted,{width:44 * Math.min(fontScale, 2),textAlign:"center"}]}>Goals</Text><Text style={[styles.muted,{width:44,textAlign:"center"}]}>Assists</Text></View>{summary.contributions.map(player=>largeText ? <Row key={player.id} title={player.name} subtitle={player.teamName} detail={`${player.goals} goals / ${player.assists} assists`} /> : <View key={player.id} style={[styles.row,styles.horizontal]}><Avatar name={player.name} size={30}/><View style={{flex:1}}><Text style={styles.title}>{player.name}</Text><Text style={styles.muted}>{player.teamName}</Text></View><Text style={[styles.title,{width:44,textAlign:"center",color:colors.green}]}>{player.goals}</Text><Text style={[styles.title,{width:44,textAlign:"center"}]}>{player.assists}</Text></View>)}</View> : <Text style={styles.muted}>No goals or assists recorded.</Text>}
    </> : tab === "teams" ? data.teams.map((team) => <View key={team.id}><Text style={styles.title}>{team.name}</Text>{team.players.map((player) => <Row key={player.id} title={player.name} />)}</View>) : games.map((game, index) => {
      const score = scoreFor(game, data.teams);
      return <View key={game.id ?? game.matchNumber} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, gap: 10, backgroundColor: "white" }}>
        <View style={[styles.horizontal,{justifyContent:"space-between",flexWrap:"wrap"}]}><Text style={styles.muted}>G{game.matchNumber}{game.scheduledStartTime ? `  ${game.scheduledStartTime.slice(0, 5)}` : ""}</Text><Badge label={game.resultStatus}/></View>
        <View style={styles.horizontal}>
          <Text style={[styles.title, { flex: 1, textAlign: "right" }]}>{teamName(game.teamAId)}</Text>
          <Text accessibilityLabel={`Score ${score.a} to ${score.b}`} style={{ fontSize: 24, fontWeight: "700", color: colors.green, textAlign: "center", minWidth: 72 }}>{score.a} : {score.b}</Text>
          <Text style={[styles.title, { flex: 1 }]}>{teamName(game.teamBId)}</Text>
        </View>
        {!writable && game.goals.length ? <Pressable accessibilityRole="button" accessibilityState={{expanded:expandedGame===index}} onPress={()=>setExpandedGame(current=>current===index?null:index)} style={[styles.horizontal,{minHeight:44,justifyContent:"center",borderTopWidth:1,borderColor:colors.border}]}><Text style={[styles.muted,{color:colors.green}]}>Match details</Text>{expandedGame===index?<ChevronUp size={16} color={colors.green}/>:<ChevronDown size={16} color={colors.green}/>}</Pressable>:null}
        {(writable || expandedGame===index ? game.goals : []).map((goal, g) => !writable ? <View key={goal.id ?? g} style={[styles.row, styles.horizontal]}>
          <View style={{ flex: 1 }}><Text style={styles.body}>{playerName(goal.scorerId) ?? "Unknown scorer"}{goal.goalType === "own_goal" ? " (own goal)" : ""}</Text>{goal.assistPlayerId ? <Text style={styles.muted}>Assist: {playerName(goal.assistPlayerId) ?? "Unknown player"}</Text> : null}</View>
          <Text style={styles.title}>{goal.goalCount}</Text>
        </View> : <View key={goal.id ?? g} style={{ paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 }}>
          <Row title={playerName(goal.scorerId) ?? "Select scorer"} subtitle="Scorer" onPress={writable && !saving ? () => setPicker({ game: index, goal: g, field: "scorerId" }) : undefined} />
          <Row title={playerName(goal.assistPlayerId) ?? "No assist"} subtitle="Assist" onPress={writable && !saving && goal.goalType !== "own_goal" ? () => setPicker({ game: index, goal: g, field: "assistPlayerId" }) : undefined} />
          <Row title={playerName(goal.concededGoalkeeperId) ?? "Unknown goalkeeper"} subtitle="Goalkeeper conceded" onPress={!saving ? () => setPicker({ game: index, goal: g, field: "concededGoalkeeperId" }) : undefined} />
          <View style={[styles.horizontal, { flexWrap: "wrap" }]}>
            <Icon label="Decrease goals" disabled={!writable || saving} onPress={() => goalUpdate(index, g, { goalCount: Math.max(1, goal.goalCount - 1) })}><Minus color={colors.ink} /></Icon>
            <Text style={styles.title}>{goal.goalCount}</Text>
            <Icon label="Increase goals" disabled={!writable || saving} onPress={() => goalUpdate(index, g, { goalCount: Math.min(99, goal.goalCount + 1) })}><Plus color={colors.ink} /></Icon>
            <Text style={styles.muted}>Own goal</Text><Switch accessibilityLabel="Own goal" disabled={!writable || saving} value={goal.goalType === "own_goal"} onValueChange={(value) => goalUpdate(index, g, { goalType: value ? "own_goal" : "goal", assistPlayerId: "" })} />
            <Icon label="Delete goal" disabled={!writable || saving} onPress={() => update(index, (value) => ({ ...value, goals: value.goals.filter((_, n) => n !== g) }))}><Trash2 color={colors.error} /></Icon>
          </View>
        </View>)}
        {writable ? <>
          <Button secondary disabled={saving || !game.teamAId || !game.teamBId} icon={<Plus color={colors.ink} />} onPress={() => update(index, (value) => ({ ...value, resultStatus: "played", goals: [...value.goals, { scorerId: "", assistPlayerId: "", goalType: "goal", goalCount: 1 }] }))}>Add goal</Button>
          <View style={styles.horizontal}><Switch accessibilityLabel="Match played" disabled={saving || game.goals.length > 0} value={game.resultStatus === "played"} onValueChange={(played) => update(index, (value) => ({ ...value, resultStatus: played ? "played" : "scheduled" }))} /><Text style={styles.body}>Played</Text></View>
        </> : null}
      </View>;
    })}
    {!games.length && tab === "games" ? <Text style={styles.muted}>No saved fixture.</Text> : null}
    {writable && tab === "games" ? <Button disabled={saving || !dirty} icon={<Save color="white" />} onPress={() => Alert.alert("Review match results", games.map((game) => { const score = scoreFor(game, data.teams); return `Game ${game.matchNumber}: ${teamName(game.teamAId)} ${score.a} - ${score.b} ${teamName(game.teamBId)} (${game.resultStatus})`; }).join("\n"), [{ text: "Keep editing", style: "cancel" }, { text: "Save results", onPress: () => void save() }])}>{saving ? "Saving..." : "Review and save scores"}</Button> : null}
    <Modal visible={!!picker} animationType="slide" onRequestClose={() => setPicker(null)}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 60 }]}>
        <Button secondary onPress={() => setPicker(null)}>Close</Button>
        {picker?.field === "assistPlayerId" ? <Row title="No assist" onPress={() => { goalUpdate(picker.game, picker.goal, { assistPlayerId: "" }); setPicker(null); }} /> : null}
        {picker?.field === "concededGoalkeeperId" ? <Row title="Unknown goalkeeper" onPress={() => { goalUpdate(picker.game, picker.goal, { concededGoalkeeperId: "" }); setPicker(null); }} /> : null}
        {pickerPlayers.filter((player) => {
          if (picker?.field === "concededGoalkeeperId") return keepers(games[picker.game], games[picker.game].goals[picker.goal]).some(p => p.player_id === player.id);
          if (!picker || picker.field !== "assistPlayerId") return true;
          const scorerId = games[picker.game].goals[picker.goal].scorerId;
          return player.id !== scorerId && data.teams.some((team) => team.players.some((entry) => entry.id === scorerId) && team.players.some((entry) => entry.id === player.id));
        }).map((player) =>
          <Row key={player.id} title={player.name} onPress={() => { if (picker) goalUpdate(picker.game, picker.goal, { [picker.field]: player.id, ...(picker.field === "scorerId" ? { assistPlayerId: "" } : {}) }); setPicker(null); }} />)}
      </ScrollView>
    </Modal>
  </Screen>;
}
function Icon({ children, label, onPress, disabled }: { children: React.ReactNode; label: string; onPress(): void; disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}>{children}</Pressable>;
}
function scoreFor(game: Game, teams: Team[]) {
  return game.goals.reduce((score, goal) => {
    const team = teams.find((candidate) => candidate.players.some((player) => player.id === goal.scorerId))?.id;
    if (!team) return score;
    const scorerTeam = goal.goalType === "own_goal" ? (team === game.teamAId ? game.teamBId : game.teamAId) : team;
    if (scorerTeam === game.teamAId) score.a += goal.goalCount;
    if (scorerTeam === game.teamBId) score.b += goal.goalCount;
    return score;
  }, { a: 0, b: 0 });
}
