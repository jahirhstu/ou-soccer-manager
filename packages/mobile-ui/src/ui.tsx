import { Children, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputProps } from "react-native";
import { ChevronRight, ChevronLeft, Circle, CircleCheck, House, CalendarDays, Trophy, Wallet, UserRound, Users, Ellipsis, type LucideIcon } from "lucide-react-native";
export const colors = { ink: "#172A25", muted: "#64736E", green: "#087D52", forest: "#064631", background: "#F3F6F5", border: "#DFE7E3", error: "#B42335", gold: "#896510", blue: "#2166a0", soft: "#E4F2EB" };
const fontFamily = Platform.OS === "ios" ? "System" : "sans-serif";
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 10, paddingBottom: 24, width: "100%", maxWidth: 720, alignSelf: "center" },
  heading: { fontFamily, fontSize: 23, lineHeight: 29, fontWeight: "700", color: colors.ink, flexShrink: 1 },
  title: { fontFamily, fontSize: 15, lineHeight: 20, fontWeight: "600", color: colors.ink },
  body: { fontFamily, fontSize: 14, lineHeight: 20, color: colors.ink },
  muted: { fontFamily, fontSize: 12, lineHeight: 17, color: colors.muted },
  row: { paddingVertical: 10, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 4 },
  horizontal: { flexDirection: "row", alignItems: "center", gap: 12 },
  field: { fontFamily, borderWidth: 1, borderColor: colors.border, borderRadius: 8, minHeight: 46, padding: 12, backgroundColor: "white", color: colors.ink, fontSize: 16 },
  error: { color: colors.error, fontSize: 15, lineHeight: 22 },
  button: { minHeight: 48, paddingVertical: 11, paddingHorizontal: 16, backgroundColor: colors.forest, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonText: { fontFamily, color: "white", fontSize: 15, fontWeight: "600" },
  secondary: { backgroundColor: "white", borderWidth: 1, borderColor: colors.border },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, minHeight: 60, backgroundColor: "white", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  section: { fontFamily, fontSize: 12, lineHeight: 18, fontWeight: "700", color: colors.muted, marginTop: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { flexGrow: 1, flexBasis: "46%", minWidth: 130, minHeight: 68, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: "white", padding: 12, gap: 8 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: "white", padding: 14, gap: 8 },
});
const tabIcons = { home: House, sessions: CalendarDays, statistics: Trophy, finances: Wallet, account: UserRound, program: CalendarDays, members: Users, more: Ellipsis };
export type TabItem = { key: keyof typeof tabIcons; label: string };
export function BottomTabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange(value: TabItem["key"]): void }) {
  return <View style={{ flexDirection: "row", backgroundColor: "white", borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 6 }}>
    {items.map((item) => { const Icon = tabIcons[item.key]; const selected = item.key === value; return <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(item.key)} style={{ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 2, gap: 4 }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 3, borderRadius: 8, backgroundColor: selected ? colors.soft : "transparent" }}><Icon size={21} color={selected ? colors.forest : colors.muted} /></View>
      <Text style={{ fontSize: 11, lineHeight: 15, textAlign: "center", color: selected ? colors.forest : colors.muted, fontWeight: selected ? "700" : "500" }}>{item.label}</Text>
    </Pressable>; })}
  </View>;
}
export function Segments({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange(value: string): void }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", backgroundColor: colors.soft, borderRadius: 8, padding: 4, gap: 4 }}>
    {options.map((option) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: value === option.value }} key={option.value} onPress={() => onChange(option.value)} style={{ flexGrow: 1, minHeight: 44, padding: 10, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: value === option.value ? colors.forest : "transparent" }}><Text style={[styles.body, { color: value === option.value ? "white" : colors.forest, fontWeight: "600" }]}>{option.label}</Text></Pressable>)}
  </View>;
}
export function Badge({ label }: { label: string }) {
  const text = label.toLowerCase();
  const color = ["rejected", "suspended", "cancelled"].includes(text) ? colors.error : text === "pending" ? colors.gold : ["scheduled", "manager", "captain"].includes(text) ? colors.blue : colors.green;
  return <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: `${color}12`, maxWidth: "100%" }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }}/><Text style={{ fontFamily, fontSize: 11, lineHeight: 16, fontWeight: "600", color, flexShrink: 1 }}>{label.replaceAll("_", " ")}</Text></View>;
}
export function SummaryLine({ label, value }: { label: string; value: string }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}><Text style={[styles.muted, { flexBasis: "35%", flexGrow: 1 }]}>{label}</Text><Text style={[styles.title, { flexBasis: "55%", flexGrow: 1, textAlign: "right" }]}>{value}</Text></View>;
}
export function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return <View style={styles.header}>{onBack ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><ChevronLeft color={colors.ink} /></Pressable> : null}<Text accessibilityRole="header" style={styles.heading}>{title}</Text></View>;
}
export function Section({ children }: { children: ReactNode }) { return <Text accessibilityRole="header" style={styles.section}>{children}</Text>; }
export function Shortcuts({ items }: { items: { title: string; subtitle?: string; icon: LucideIcon; onPress(): void }[] }) {
  const { fontScale } = useWindowDimensions();
  return <View style={styles.grid}>{items.map(({ title, subtitle, icon: Icon, onPress }, index) => <Pressable key={title} onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.tile, { flexDirection: "row", alignItems: "center", flexBasis: fontScale > 1.3 ? "100%" : "46%" }, pressed && { backgroundColor: colors.soft }]}><View style={{ width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: index % 3 === 1 ? "#EAF1FA" : colors.soft }}><Icon size={19} color={index % 3 === 1 ? colors.blue : colors.green} /></View><View style={{ flex: 1, gap: 2 }}><Text style={[styles.title, { fontSize: 13, lineHeight: 18 }]}>{title}</Text>{subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}</View></Pressable>)}</View>;
}
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily, color: colors.forest, fontWeight: "700", fontSize: 13 }}>{initials}</Text></View>;
}
export function Metrics({ items }: { items: { label: string; value: string | number; color?: string }[] }) {
  const { fontScale } = useWindowDimensions();
  return <View style={{ flexDirection: "row", flexWrap: "wrap", paddingVertical: 10, backgroundColor: "white", borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
    {items.map((item,index)=><View key={item.label} style={{ flexGrow: 1, flexBasis: fontScale > 1.3 ? "48%" : `${100/items.length}%`, paddingHorizontal: 10, paddingVertical: 4, alignItems: "center", borderLeftWidth: index && fontScale<=1.3 ? StyleSheet.hairlineWidth : 0, borderColor: colors.border }}><Text style={{ fontFamily, fontSize: 24, lineHeight: 30, fontWeight: "700", color: item.color??colors.forest, fontVariant: ["tabular-nums"] }}>{item.value}</Text><Text style={[styles.muted,{textAlign:"center"}]}>{item.label}</Text></View>)}
  </View>;
}
export function Screen({ title, children, onBack }: { title: string; children: ReactNode; onBack?: () => void }) {
  useAndroidBack(onBack);
  return <View style={styles.screen}><Header title={title} onBack={onBack} /><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>{children}</ScrollView></View>;
}
export function useAndroidBack(onBack?: () => void) {
  useEffect(() => {
    if (!onBack) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => subscription.remove();
  }, [onBack]);
}
export function Choices({ options, value, onChange, disabled }: {
  options: { value: string; label: string }[]; value: string; onChange(value: string): void; disabled?: boolean;
}) {
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  if(options.length>5) return <>
    <Pressable accessibilityRole="button" accessibilityLabel={options.find(option=>option.value===value)?.label || "Select option"} accessibilityState={{disabled:!!disabled,expanded:open}} disabled={disabled} onPress={()=>{setQuery("");setOpen(true);}} style={[styles.field,styles.horizontal,{justifyContent:"space-between"}]}><Text style={[styles.body,{flex:1}]}>{options.find(option=>option.value===value)?.label || "Select option"}</Text><ChevronRight size={18} color={colors.muted}/></Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={()=>setOpen(false)}><View style={[styles.screen,{paddingTop:54}]}><Header title="Choose option" onBack={()=>setOpen(false)}/><View style={{padding:16}}><Field label="Search" value={query} onChangeText={setQuery}/></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{options.filter(option=>option.label.toLowerCase().includes(query.toLowerCase())).map(option=><Row key={option.value} title={option.label} subtitle={value===option.value?"Selected":undefined} onPress={()=>{onChange(option.value);setOpen(false);}}/>)}</ScrollView></View></Modal>
  </>;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{options.map((option) => <Pressable key={option.value} accessibilityRole="radio"
    accessibilityState={{ checked: value === option.value, disabled: !!disabled }} disabled={disabled}
    onPress={() => onChange(option.value)} style={[styles.horizontal, { minHeight: 44, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: value === option.value ? colors.green : colors.border, backgroundColor: value === option.value ? colors.soft : "white", maxWidth: "100%" }, disabled && { opacity: 0.5 }]}>
    {value === option.value ? <CircleCheck size={18} color={colors.green} /> : <Circle size={18} color={colors.muted} />}
    <Text style={[styles.body, { flexShrink: 1 }]}>{option.label}</Text>
  </Pressable>)}</View>;
}
export function Columns({ children }: { children: ReactNode }) {
  const { fontScale }=useWindowDimensions();
  return <View style={styles.grid}>{Children.toArray(children).map((child,index)=><View key={index} style={{flexGrow:1,flexBasis:fontScale>1.3?"100%":"46%",minWidth:130}}>{child}</View>)}</View>;
}
export function Button({ children, onPress, disabled, secondary, icon }: { children: ReactNode; onPress(): void; disabled?: boolean; secondary?: boolean; icon?: ReactNode }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled}
    style={[styles.button, secondary && styles.secondary, disabled && { opacity: 0.5 }]}>
    {icon}<Text style={[styles.buttonText, { flexShrink: 1, textAlign: "center" }, secondary && { color: colors.ink }]}>{children}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 6 }}><Text style={styles.muted}>{label}</Text><TextInput accessibilityLabel={label} style={styles.field} placeholderTextColor={colors.muted} {...props} /></View>;
}
export function Busy() { return <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator size="large" color={colors.green} accessibilityLabel="Loading" /></View>; }
export function Row({ title, subtitle, detail, onPress }: { title: string; subtitle?: string; detail?: string; onPress?: () => void }) {
  return <Pressable style={[styles.row, styles.horizontal]} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined}>
    <View style={{ flex: 1, gap: 4 }}><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}{detail ? <Text style={styles.body}>{detail}</Text> : null}</View>
    {onPress ? <ChevronRight color={colors.muted} /> : null}
  </Pressable>;
}
