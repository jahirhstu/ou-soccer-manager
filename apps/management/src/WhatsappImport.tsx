import { useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { accountLoadError, importIdentityCandidates } from "@ou/contracts";
import { useMobile } from "@ou/mobile-core";
import { Badge, Button, Choices, Field, Row, Screen, Section, styles } from "@ou/mobile-ui";

type Options = {
  players: { id: string; display_name: string }[];
  aliases: { player_id: string; alias_name: string }[];
  seasons: { id: string; name: string }[];
  sessions: { id: string; name: string; session_date: string; season_id: string }[];
};
type Parsed = { players: { name: string }[]; importType: string; warnings: string[]; [key: string]: unknown };
function previewRecord(value: unknown) {
  if (!value || typeof value !== "object") return { title: String(value), detail: "" };
  const row = value as Record<string, unknown>;
  const title = String(row.playerName ?? row.scorerName ?? row.originalPlayerName ?? row.name ?? row.teamName ?? (row.matchNumber ? `Game ${row.matchNumber}` : "Record"));
  const hidden = new Set(["confidence", "matchedPlayerId", "matchedScorerId", "matchedAssistId", "amountSource"]);
  const detail = Object.entries(row).filter(([key,field])=>!hidden.has(key)&&field!=null&&String(field)!==title).map(([key,field])=>{
    const label=key.replace(/([A-Z])/g," $1");
    const text=Array.isArray(field)?field.filter(item=>typeof item==="string").join(", "):typeof field==="object"?"":String(field);
    return text?`${label}: ${text}`:"";
  }).filter(Boolean).join(" / ");
  return {title,detail};
}
export function WhatsappImport({ onBack }: { onBack(): void }) {
  const { client, workspace } = useMobile();
  const [options, setOptions] = useState<Options | null>(null);
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [seasonId, setSeasonId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [matches, setMatches] = useState<Record<string,string>>({});
  const [picker, setPicker] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  async function request(action: string, data: Record<string,unknown> = {}) {
    const base = process.env.EXPO_PUBLIC_WEB_API_URL?.replace(/\/$/, "");
    if (!base || !base.startsWith("https://")) throw new Error("Configure EXPO_PUBLIC_WEB_API_URL with the HTTPS development website URL, then restart Expo.");
    const auth = await client.auth.getSession();
    if (auth.error || !auth.data.session) throw new Error("Sign in again.");
    const response = await fetch(`${base}/api/mobile/whatsapp`, {
      method: "POST", headers: { Authorization: `Bearer ${auth.data.session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, programId: workspace!.programId, ...data })
    });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The development import API is unavailable. Deploy the updated website and check its access protection.");
    const result = await response.json();
    if (result.protection?.vercel_auth_enabled || result.message === "Protected by Vercel Authentication") throw new Error("Vercel protection is blocking the mobile import API. Ask the administrator to configure native API access; do not place a bypass secret in the app.");
    if (!response.ok || result.error) throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "Import failed.");
    return result;
  }
  useEffect(() => {
    let active = true; setError("");
    void request("options").then(result => { if (active) setOptions(result); }).catch(cause => { if (active) setError(accountLoadError(cause)); });
    return () => { active = false; };
  }, [workspace?.programId, refresh]);
  async function parse() {
    if (lock.current || !options) return;
    lock.current=true;setBusy(true);setError("");
    try {
      const result = await request("parse", { rawText });
      const value = result.parsed as Parsed;
      setParsed(value); setMatches(Object.fromEntries(value.players.map(player => {
        const candidates=importIdentityCandidates(player.name,options.players,options.aliases);
        const exact=candidates.length===1 && candidates[0].display_name.trim().toLowerCase()===player.name.trim().toLowerCase();
        return [player.name,exact?candidates[0].id:""];
      })));
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { lock.current=false;setBusy(false); }
  }
  async function confirm() {
    if (lock.current || done) return;
    lock.current=true;setBusy(true);setError("");
    try {
      const result=await request("confirm",{rawText,parsed,seasonId,sessionId,matches});
      setDone([result.message,result.warning].filter(Boolean).join("\n"));
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { lock.current=false;setBusy(false); }
  }
  if (picker && options) return <Screen title={`Match ${picker}`} onBack={()=>setPicker(null)}>
    <Field label="Search players" value={search} onChangeText={setSearch} />
    <Row title="Ignore this name" onPress={()=>{setMatches(current=>({...current,[picker]:"__ignore__"}));setPicker(null);}} />
    {options.players.filter(player=>player.display_name.toLowerCase().includes(search.toLowerCase())).map(player=><Row key={player.id} title={player.display_name} subtitle={player.id} onPress={()=>{setMatches(current=>({...current,[picker]:player.id}));setPicker(null);}} />)}
  </Screen>;
  return <Screen title="WhatsApp import" onBack={busy?undefined:onBack}>
    {error?<><Text style={styles.error}>{error}</Text>{!options?<Button onPress={()=>setRefresh(value=>value+1)}>Retry</Button>:null}</>:null}
    {done?<><Badge label="Imported"/><Text style={styles.body}>{done}</Text></>:!options?<Text style={styles.muted}>Loading import options...</Text>:!parsed?<>
      <Field label="WhatsApp message" value={rawText} onChangeText={setRawText} multiline maxLength={30000} editable={!busy}/>
      <Button disabled={busy||!rawText.trim()} onPress={()=>void parse()}>{busy?"Parsing...":"Parse message"}</Button>
    </>:<>
      <Badge label={parsed.importType}/>
      <Section>IMPORT TARGET</Section>
      <Choices options={options.seasons.map(season=>({value:season.id,label:season.name}))} value={seasonId} disabled={busy} onChange={value=>{setSeasonId(value);setSessionId("");}}/>
      <Choices options={[{value:"",label:"No session"},...options.sessions.filter(session=>session.season_id===seasonId).map(session=>({value:session.id,label:`${session.session_date} ${session.name||""}`}))]} value={sessionId} disabled={busy} onChange={setSessionId}/>
      <Section>PLAYER IDENTITIES</Section>
      {parsed.players.map(player=>{
        const candidates=importIdentityCandidates(player.name,options.players,options.aliases);
        const id=matches[player.name];
        return <View key={player.name} style={styles.card}><Badge label={id==="__ignore__"?"Ignored":id?"Selected":candidates.length>1?"Ambiguous name":"Needs selection"}/>
          <Row title={player.name} subtitle={id==="__ignore__"?"Not imported":options.players.find(value=>value.id===id)?.display_name||candidates.map(value=>value.display_name).join(", ")||"Select an existing player"} onPress={busy?undefined:()=>{setSearch("");setPicker(player.name);}}/>
        </View>;
      })}
      <Section>PARSED RECORDS</Section>
      {Object.entries(parsed).filter(([key,value])=>Array.isArray(value)&&!["players","warnings"].includes(key)).map(([key,value])=><View key={key}><Text style={styles.heading}>{key.charAt(0).toUpperCase()+key.slice(1)}</Text>{(value as unknown[]).length?(value as unknown[]).map((row,index)=>{const record=previewRecord(row);return <Row key={index} title={record.title} detail={record.detail}/>;}):<Text style={styles.muted}>None</Text>}</View>)}
      {parsed.warnings?.map((warning,index)=><Text key={index} style={styles.error}>{warning}</Text>)}
      <Button secondary disabled={busy} onPress={()=>setParsed(null)}>Edit message</Button>
      <Button disabled={busy||!seasonId||(parsed.importType==="session_update"&&!sessionId)||parsed.players.some(player=>!matches[player.name])} onPress={()=>Alert.alert("Confirm import?",`${options.seasons.find(season=>season.id===seasonId)?.name}\n${parsed.players.filter(player=>matches[player.name]!=="__ignore__").length} selected players. Reviewed payments and attendance will be recorded.`,[{text:"Cancel",style:"cancel"},{text:"Confirm",onPress:()=>void confirm()}])}>{busy?"Importing...":"Review and confirm"}</Button>
    </>}
  </Screen>;
}
