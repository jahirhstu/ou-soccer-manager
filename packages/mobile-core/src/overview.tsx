import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { accountLoadError, type Page, type Resource } from "@ou/contracts";
import { Button, Section, colors, styles } from "@ou/mobile-ui";
import { useMobile } from "./provider";
import { RecordItem } from "./record-item";
import { Layers3 } from "@ou/mobile-ui";

export function RecordPreview({ resource, title, onSelect }: { resource: Resource; title: string; onSelect?: (id: string) => void }) {
  const { client, workspace } = useMobile();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setPage(null); setError("");
    void (async () => {
      try {
        const result = await client.rpc("mobile_list", { p_program_id: workspace!.programId, p_resource: resource, p_offset: 0 });
        if (result.error) throw result.error;
        if (active) setPage(result.data as Page);
      } catch (cause) { if (active) setError(accountLoadError(cause)); }
    })();
    return () => { active = false; };
  }, [client, workspace?.programId, resource, attempt]);
  return <View style={{ gap: 8 }}><Section>{title}</Section>
    {error ? <><Text style={styles.error}>{error}</Text><Button secondary onPress={() => setAttempt(attempt + 1)}>Retry</Button></> : !page ? <ActivityIndicator color={colors.green} accessibilityLabel={`Loading ${title}`} /> : page.rows.length ? page.rows.slice(0, 1).map((row) => <RecordItem key={row.id} row={row} resource={resource} onPress={onSelect ? () => onSelect(row.id) : undefined}/>) : <Text style={styles.muted}>No records yet.</Text>}
  </View>;
}

export function ProgramContext() {
  const { workspace } = useMobile();
  return <View style={{ paddingHorizontal:16,paddingVertical:10,backgroundColor:colors.forest,flexDirection:"row",alignItems:"center",gap:10 }}><View style={{width:30,height:30,borderRadius:6,backgroundColor:"#FFFFFF18",alignItems:"center",justifyContent:"center"}}><Layers3 size={17} color="#DCEDE4"/></View><View style={{flex:1}}><Text style={{color:"#BBD8C9",fontSize:10,lineHeight:14,fontWeight:"600"}}>{workspace?.organizationName}</Text><Text style={{color:"white",fontSize:14,lineHeight:19,fontWeight:"700"}}>{workspace?.programName}</Text></View><Text style={{color:"#DCEDE4",fontSize:11,fontWeight:"600"}}>{workspace?.role}</Text></View>;
}
