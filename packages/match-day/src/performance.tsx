import { useEffect, useRef, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { Records, useMobile } from "@ou/mobile-core";
import { accountLoadError, matchPositions, previousMatchPositions, type PerformanceData, type SeasonPerformanceRow } from "@ou/contracts";
import { Button, Busy, Choices, Metrics, Row, Screen, Section, Segments, styles } from "@ou/mobile-ui";

export function MatchPerformance({ sessionId, onBack }: { sessionId: string; onBack(): void }) {
  const { client, workspace } = useMobile();
  const [data, setData] = useState<PerformanceData | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [tab, setTab] = useState("results");
  const [matchId, setMatchId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { position: string; participated: boolean }>>({});
  const [ballot, setBallot] = useState<Record<string, string>>({});
  const [season, setSeason] = useState<SeasonPerformanceRow[]>([]);
  useEffect(() => {
    let active = true;
    setData(null); setError("");
    void (async () => {
      const result = await client.rpc("session_performance", { p_session_id: sessionId });
      if (result.error) throw result.error;
      if (!active) return;
      const value = result.data as PerformanceData;
      setData(value); setMatchId(current => current || value.matches[0]?.id || "");
      const ranks = await client.rpc("season_performance", { p_season_id: value.session.seasonId });
      if (ranks.error) throw ranks.error;
      if (active) setSeason(ranks.data ?? []);
    })().catch(cause => { if (active) setError(accountLoadError(cause)); });
    return () => { active = false; };
  }, [client, sessionId, workspace?.programId, reload]);
  async function save(name: string, args: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await client.rpc(name, args);
      if (result.error) throw result.error;
      setEdits({}); setBallot({}); setReload(n => n + 1);
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!data) return error ? <Screen title="Performance" onBack={onBack}><Text style={styles.error}>{error}</Text><Button onPress={() => setReload(n => n + 1)}>Retry</Button></Screen> : <Busy />;
  const match = data.matches.find(m => m.id === matchId);
  const teams = data.teams.filter(t => [match?.teamAId, match?.teamBId].includes(t.id));
  const valueFor = (id: string) => {
    const p = data.positions.find(p => p.match_id === matchId && p.player_id === id);
    return edits[`${matchId}:${id}`] ?? { position: p?.position ?? "", participated: p?.participated ?? false };
  };
  return <Screen title="Player performance" onBack={onBack}>
    <Text style={styles.muted}>{data.session.name}</Text>
    <Segments value={tab} onChange={setTab} options={[{ value: "results", label: "Ratings" }, ...(data.canManage ? [{ value: "positions", label: "Positions" }] : []), { value: "votes", label: "Awards" }, { value: "season", label: "Season" }]} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {tab === "positions" && data.canManage ? <>
      <Choices value={matchId} onChange={setMatchId} options={data.matches.map(m => ({ value: m.id, label: `G${m.number} · ${m.status}` }))} />
      {Object.keys(previousMatchPositions(data, matchId)).length ? <Button secondary disabled={busy} onPress={() => setEdits(old => ({ ...old, ...previousMatchPositions(data, matchId) }))}>Copy previous match positions</Button> : null}
      {teams.map(team => <View key={team.id}><Section>{team.name}</Section>{team.players.map(player => {
        const value = valueFor(player.id);
        const update = (change: Partial<typeof value>) => setEdits(old => ({ ...old, [`${matchId}:${player.id}`]: { ...value, ...change } }));
        return <View key={player.id} style={styles.row}>
          <View style={styles.horizontal}><Text style={[styles.title, { flex: 1 }]}>{player.name}</Text><Text style={styles.muted}>Played</Text><Switch accessibilityLabel={`${player.name} played`} disabled={busy} value={value.participated} onValueChange={participated => update({ participated })} /></View>
          <Choices disabled={busy} value={value.position} onChange={position => update({ position })} options={[{ value: "", label: "Unknown" }, ...matchPositions.map(p => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))]} />
        </View>;
      })}</View>)}
      <Button disabled={busy || !match} onPress={() => void save("confirm_match_positions", { p_match_id: matchId, p_players: teams.flatMap(t => t.players.map(p => ({ playerId: p.id, ...valueFor(p.id) }))) })}>Confirm participation</Button>
    </> : null}
    {tab === "results" ? <>
      {!data.results.length ? <Text style={styles.muted}>No confirmed participation in played matches.</Text> : null}
      {data.results.map(r => <View key={r.player_id}>
        <Row title={r.player_name} subtitle={`${r.positions?.join(" / ") || "Unknown"} · ${r.matches_played} matches${r.incomplete ? " · incomplete" : ""}`} detail={`${Number(r.final_rating).toFixed(2)} points`} onPress={() => setExpanded(expanded === r.player_id ? null : r.player_id)} />
        {expanded === r.player_id ? <><Metrics items={[{ label: "Match /40", value: r.match_points }, { label: "Captain /60", value: r.captain_points }]} />
          {data.details.filter(d => d.player_id === r.player_id).map(d => <Row key={d.match_number} title={`G${d.match_number} · ${d.position ?? "Unknown"} · ${d.breakdown.rating ?? "Unrated"}/10`} subtitle={Object.entries(d.breakdown).filter(([k]) => k !== "rating" && k !== "version").map(([k, v]) => `${k}: ${v}`).join(" · ")} detail={d.position === "goalkeeper" ? `Conceded: ${d.keeper_conceded ?? "Unknown"}${d.clean_sheet ? " · Clean sheet" : ""}` : undefined} />)}
        </> : null}
      </View>)}
    </> : null}
    {tab === "votes" ? <>
      <Text style={styles.muted}>{data.closed ? "Voting closed" : data.session.status !== "completed" ? "Voting opens after completion" : "Provisional awards"} · {data.votes.length}/{data.teams.length * 3} nominations</Text>
      {matchPositions.slice(0, 3).map(category => <View key={category}><Section>{`Best ${category}`}</Section>{data.awards.filter(a => a.category === category).map(a => <Row key={a.player_id} title={a.player_name} detail={`${a.nominations} nominations`} />)}{!data.awards.some(a => a.category === category) ? <Text style={styles.muted}>No nominations</Text> : null}</View>)}
      {!data.closed && data.session.status === "completed" ? data.teams.filter(t => t.canVote).map(team => <View key={team.id}><Section>{`${team.name} ballot`}</Section>{matchPositions.slice(0, 3).map(category => {
        const key = `${team.id}:${category}`;
        const value = ballot[key] ?? data.votes.find(v => v.captain_team_id === team.id && v.category === category)?.player_id ?? "";
        const eligible = [...new Map(data.details.filter(d => d.position === category && !team.players.some(p => p.id === d.player_id)).map(d => [d.player_id, d])).values()];
        return <View key={category} style={styles.row}><Text style={styles.title}>{`Best ${category}`}</Text><Choices disabled={busy} value={value} onChange={id => setBallot(b => ({ ...b, [key]: id }))} options={eligible.map(p => ({ value: p.player_id, label: p.player_name }))} />
          <Button secondary disabled={busy || !value} onPress={() => void save("nominate_session_player", { p_session_id: sessionId, p_team_id: team.id, p_category: category, p_player_id: value })}>Save nomination</Button></View>;
      })}</View>) : null}
      {data.canClose ? <Button secondary disabled={busy} onPress={() => Alert.alert(data.closed ? "Reopen voting?" : "Close voting?", "Incomplete ballots remain incomplete. This action is recorded.", [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => void save("close_performance_voting", { p_session_id: sessionId, p_closed: !data.closed }) }])}>{data.closed ? "Reopen voting" : "Close voting"}</Button> : null}
    </> : null}
    {tab === "season" ? matchPositions.map(position => <View key={position}><Section>{position.toUpperCase()}</Section>{season.filter(r => r.position === position).map(r => <Row key={r.player_id} title={r.player_name} subtitle={`${r.matches_played} matches · ${r.sessions_played} sessions · ${r.nominations} nominations`} detail={`${Number(r.average_session_rating).toFixed(2)}/${position === "forward" ? 40 : 100}`} />)}{!season.some(r => r.position === position) ? <Text style={styles.muted}>No confirmed performances.</Text> : null}</View>) : null}
  </Screen>;
}

export function PerformanceHub({ onBack }: { onBack(): void }) {
  const { client, workspace } = useMobile();
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rows, setRows] = useState<SeasonPerformanceRow[]>([]);
  const [history, setHistory] = useState<Array<{ session_id: string; session_name: string; positions: string[]; final_rating: number; matches_played: number; goals: number; assists: number; captain_points: number }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(""); setRows([]); setHistory([]); setBusy(true);
    void (async () => {
      if (workspace?.playerId) {
        const result = await client.rpc("player_performance_history", { p_program_id: workspace.programId, p_player_id: workspace.playerId });
        if (result.error) throw result.error;
        if (active) setHistory(result.data ?? []);
      }
      if (seasonId) {
        const result = await client.rpc("season_performance", { p_season_id: seasonId });
        if (result.error) throw result.error;
        if (active) setRows(result.data ?? []);
      }
    })().catch(cause => { if (active) setError(accountLoadError(cause)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [client, workspace?.programId, workspace?.playerId, seasonId, retry]);
  if (sessionId) return <MatchPerformance sessionId={sessionId} onBack={() => setSessionId(null)} />;
  const personal = <View><Section>MY MATCH RATINGS</Section>{history.map(r => <Row key={r.session_id} title={r.session_name} subtitle={`${r.positions?.join(" / ") || "Unknown"} · ${r.matches_played} matches · ${r.goals} goals · ${r.assists} assists · ${r.captain_points} captain points`} detail={`${Number(r.final_rating).toFixed(2)} points`} onPress={() => setSessionId(r.session_id)} />)}{!busy && !history.length ? <Text style={styles.muted}>No confirmed performances.</Text> : null}{error ? <><Text style={styles.error}>{error}</Text><Button onPress={() => setRetry(n => n + 1)}>Retry</Button></> : null}</View>;
  if (!seasonId) return <Records resource="seasons" title="Performance by season" onBack={onBack} onSelect={setSeasonId} header={personal} />;
  return <Screen title="Position leaderboards" onBack={() => setSeasonId(null)}>{personal}{busy ? <Text style={styles.muted}>Loading...</Text> : null}{matchPositions.map(position => <View key={position}><Section>{position.toUpperCase()}</Section>{rows.filter(r => r.position === position).map(r => <Row key={r.player_id} title={r.player_name} subtitle={`${r.matches_played} matches · ${r.sessions_played} sessions · ${r.nominations} nominations`} detail={`${Number(r.average_session_rating).toFixed(2)}/${position === "forward" ? 40 : 100}`} />)}{!busy && !rows.some(r => r.position === position) ? <Text style={styles.muted}>No confirmed performances.</Text> : null}</View>)}</Screen>;
}
