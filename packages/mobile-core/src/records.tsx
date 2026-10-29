import { useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { accountLoadError, filterRecordPage, recordStatus, type ListRow, type Page, type Resource } from "@ou/contracts";
import { Button, Choices, Field, Header, styles, useAndroidBack } from "@ou/mobile-ui";
import { useMobile } from "./provider";
import { RecordItem } from "./record-item";

export function Records({ resource, title, onBack, onSelect, header }: {
  resource: Resource; title: string; onBack?: () => void; onSelect?: (id: string, row: ListRow) => void; header?: React.ReactNode;
}) {
  const { client, workspace } = useMobile();
  useAndroidBack(onBack);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true); setPage(null); setError("");
    void Promise.resolve(client.rpc("mobile_list", { p_program_id: workspace!.programId, p_resource: resource, p_offset: offset })).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError(loadError.message); else setPage(data as Page);
      setBusy(false);
    }).catch((cause: unknown) => { if (active) { setError(accountLoadError(cause)); setBusy(false); } });
    return () => { active = false; };
  }, [client, workspace?.programId, resource, offset, refresh]);
  const rows = filterRecordPage(page?.rows ?? [], resource, query, status);
  const statuses = [...new Set((page?.rows ?? []).map((row) => recordStatus(resource, row)).filter(Boolean))];
  return <View style={styles.screen}><Header title={title} onBack={onBack} /><FlatList style={styles.screen} contentContainerStyle={styles.content} data={rows}
    keyExtractor={(row) => row.id} refreshing={busy} onRefresh={() => setRefresh((value) => value + 1)}
    keyboardShouldPersistTaps="handled"
    ListHeaderComponent={<View style={{ gap: 10 }}>{header}<Field label="Search this page" placeholder="Name, season or details" value={query} onChangeText={setQuery} autoCapitalize="none" />{statuses.length > 1 ? <Choices options={[{ value: "", label: "All statuses" }, ...statuses.map((value) => ({ value, label: value }))]} value={status} onChange={setStatus} /> : null}</View>}
    renderItem={({ item }) => <RecordItem resource={resource} row={item} onPress={onSelect ? () => onSelect(item.id, item) : undefined} />}
    ListEmptyComponent={<Text style={error ? styles.error : styles.muted}>{error || (busy ? "Loading..." : "No records.")}</Text>}
    ListFooterComponent={<View style={{ gap: 12 }}>
      {error ? <Button onPress={() => setRefresh((value) => value + 1)}>Retry</Button> : null}
      <Text style={styles.muted}>Page {Math.floor(offset / 25) + 1}</Text>
      <View style={styles.horizontal}><Button secondary disabled={busy || offset === 0} onPress={() => { setStatus(""); setOffset(Math.max(0, offset - 25)); }}>Previous</Button><Button secondary disabled={busy || !page?.hasMore} onPress={() => { setStatus(""); setOffset(offset + 25); }}>Next</Button></View>
    </View>} /></View>;
}
