import { useEffect, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { accountLoadError, money, validAmount } from "@ou/contracts";
import { Records, useMobile } from "@ou/mobile-core";
import { Button, Choices, Columns, Field, Row, Screen, Section, Shortcuts, SummaryLine, styles } from "@ou/mobile-ui";
import { ArrowDownLeft, Undo2, ArrowLeftRight, CalendarArrowUp, ReceiptText } from "lucide-react-native";

type Kind = "payment" | "refund" | "transfer" | "carry" | "expense";
type Selection = "seasonId" | "playerId" | "recipientId" | "destinationSeasonId";
const labels: Record<Kind, string> = { payment: "Payment received", refund: "Completed refund", transfer: "Player credit transfer", carry: "Carry credit forward", expense: "Expense paid" };
export function Finance({ onBack }: { onBack(): void }) {
  const { client, workspace } = useMobile();
  const [kind, setKind] = useState<Kind | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selected, setSelected] = useState<Partial<Record<Selection, string>>>({});
  const [names, setNames] = useState<Partial<Record<Selection, string>>>({});
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [method, setMethod] = useState("e-transfer");
  const [category, setCategory] = useState("other");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submission = useRef<{ id: string; payload: string } | null>(null);
  const [preview, setPreview] = useState(false);
  const [credit, setCredit] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setCredit(null); setPreview(false);
    if (selected.seasonId && selected.playerId && ["refund", "transfer", "carry"].includes(kind ?? "")) {
      void client.rpc("mobile_credit_preview", { p_program_id: workspace!.programId, p_season_id: selected.seasonId, p_player_id: selected.playerId }).then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setError(loadError.message); else setCredit(data as string);
      });
    }
    return () => { active = false; };
  }, [client, workspace?.programId, selected.seasonId, selected.playerId, kind]);
  if (selection) return <Records resource={selection === "seasonId" || selection === "destinationSeasonId" ? "seasons" : "players"} title="Select record"
    onBack={() => setSelection(null)} onSelect={(id, row) => { setSelected((value) => ({ ...value, [selection]: id })); setNames((value) => ({ ...value, [selection]: row.title })); setSelection(null); setPreview(false); }} />;
  if (!kind) return <Screen title="Record transaction" onBack={onBack}>
    <Shortcuts items={(Object.keys(labels) as Kind[]).filter(value=>workspace!.modules[value==="expense"?"expenses":"payments"]!==false).map(value=>({title:labels[value],icon:{payment:ArrowDownLeft,refund:Undo2,transfer:ArrowLeftRight,carry:CalendarArrowUp,expense:ReceiptText}[value],onPress:()=>setKind(value)}))}/>
  </Screen>;
  const data = { ...selected, amount, date, method, category, note };
  const needsCredit = ["refund", "transfer", "carry"].includes(kind);
  const withinCredit = !needsCredit || (credit !== null && validAmount(amount) && cents(amount) <= cents(credit));
  const valid = validAmount(amount) && withinCredit && /^\d{4}-\d{2}-\d{2}$/.test(date) && selected.seasonId &&
    (kind === "expense" || selected.playerId) && (kind !== "transfer" || selected.recipientId && selected.recipientId !== selected.playerId) &&
    (kind !== "carry" || selected.destinationSeasonId && selected.destinationSeasonId !== selected.seasonId);
  async function save() {
    if (pending || !valid || !kind) return;
    setPending(true); setError("");
    const payload = JSON.stringify({ kind, data });
    // Preserve the id across uncertain network retries; changed input gets a new id.
    if (submission.current?.payload !== payload) submission.current = { id: Crypto.randomUUID(), payload };
    try {
      const result = await client.rpc("mobile_record_finance", { p_program_id: workspace!.programId, p_kind: kind, p_submission_id: submission.current!.id, p_data: data });
      if (result.error) throw result.error;
      Alert.alert("Transaction recorded"); onBack();
    } catch (cause) { setError(accountLoadError(cause)); }
    finally { setPending(false); }
  }
  if (preview) return <Screen title="Review transaction" onBack={pending ? undefined : () => setPreview(false)}>
    <Text style={styles.heading}>{money(amount, workspace!.currency)}</Text>
    <Text style={styles.title}>{labels[kind]}</Text>
    <SummaryLine label={kind === "carry" ? "From season" : "Season"} value={names.seasonId ?? ""} />
    {kind !== "expense" ? <SummaryLine label={kind === "transfer" ? "From player" : "Player"} value={names.playerId ?? ""} /> : null}
    {kind === "transfer" ? <SummaryLine label="To player" value={names.recipientId ?? ""} /> : null}
    {kind === "carry" ? <SummaryLine label="To season" value={names.destinationSeasonId ?? ""} /> : null}
    <SummaryLine label="Date" value={date} />
    {kind === "payment" || kind === "refund" ? <SummaryLine label="Method" value={method} /> : null}
    {kind === "expense" ? <SummaryLine label="Category" value={category.replaceAll("_", " ")} /> : null}
    {note ? <SummaryLine label="Reference / note" value={note} /> : null}
    {kind === "refund" ? <Text style={styles.body}>Confirm that this money has already been returned outside the app.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button disabled={pending || !valid} onPress={() => void save()}>{pending ? "Recording..." : "Confirm transaction"}</Button>
    <Button secondary disabled={pending} onPress={() => setPreview(false)}>Edit details</Button>
  </Screen>;
  return <Screen title={labels[kind]} onBack={pending ? undefined : () => setKind(null)}>
    <Section>1. PEOPLE AND SEASONS</Section>
    <Row title="Season" subtitle={names.seasonId || "Select season"} onPress={pending ? undefined : () => setSelection("seasonId")} />
    {kind !== "expense" ? <Row title={kind === "transfer" ? "Funding player" : "Player"} subtitle={names.playerId || "Select player"} onPress={pending ? undefined : () => setSelection("playerId")} /> : null}
    {kind === "transfer" ? <Row title="Recipient" subtitle={names.recipientId || "Select recipient"} onPress={pending ? undefined : () => setSelection("recipientId")} /> : null}
    {kind === "carry" ? <Row title="Destination season" subtitle={names.destinationSeasonId || "Select destination season"} onPress={pending ? undefined : () => setSelection("destinationSeasonId")} /> : null}
    {["refund", "transfer", "carry"].includes(kind) && selected.playerId ? <Text style={styles.title}>Available credit: {credit === null ? "Loading..." : `${workspace!.currency} ${credit}`}</Text> : null}
    {needsCredit && credit !== null ? <Button secondary disabled={pending || !validAmount(credit)} onPress={() => { setAmount(credit); setPreview(false); }}>Use full credit</Button> : null}
    <Section>2. TRANSACTION DETAILS</Section>
    <Columns><Field label={`Amount (${workspace!.currency})`} keyboardType="decimal-pad" value={amount} onChangeText={(value) => { setAmount(value); setPreview(false); }} editable={!pending} />
    <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={(value) => { setDate(value); setPreview(false); }} editable={!pending} />
    </Columns>
    {needsCredit && amount && !withinCredit ? <Text style={styles.error}>Enter an amount within the available credit.</Text> : null}
    {kind === "payment" || kind === "refund" ? <Choices options={["e-transfer", "cash", "other"].map((value) => ({ value, label: value }))} value={method} disabled={pending} onChange={(value) => { setMethod(value); setPreview(false); }} /> : null}
    {kind === "expense" ? <Choices options={["dome_rent", "food", "jersey", "equipment", "other"].map((value) => ({ value, label: value.replaceAll("_", " ") }))} value={category} disabled={pending} onChange={(value) => { setCategory(value); setPreview(false); }} /> : null}
    <Field label="Reference or note (optional)" value={note} onChangeText={(value) => { setNote(value); setPreview(false); }} maxLength={300} editable={!pending} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Button disabled={!valid || pending} onPress={() => setPreview(true)}>Review transaction</Button>
  </Screen>;
}
function cents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
