import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export type SelectOption = { label: string; value: string; detail?: string };

export function SelectModal({ title, options, value, visible, onChange, onClose }: { title: string; options: SelectOption[]; value?: string | null; visible: boolean; onChange(value: string): void; onClose(): void }) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}><Text style={styles.title}>{title}</Text><Pressable onPress={onClose}><Text style={styles.done}>Done</Text></Pressable></View>
        {options.map((option) => {
          const selected = option.value === value;
          return <Pressable key={option.value} onPress={() => { onChange(option.value); onClose(); }} style={[styles.option, selected && styles.selected]}>
            <View style={styles.text}><Text style={styles.label}>{option.label}</Text>{option.detail ? <Text style={styles.detail}>{option.detail}</Text> : null}</View>
            <Text style={styles.check}>{selected ? "✓" : ""}</Text>
          </Pressable>;
        })}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, backgroundColor: colors.background },
  header: { marginBottom: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.ink, fontSize: 26, fontWeight: "900" },
  done: { color: colors.pitch, fontWeight: "800" },
  option: { minHeight: 62, marginBottom: 9, padding: 14, flexDirection: "row", alignItems: "center", borderRadius: 13, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  selected: { borderColor: colors.pitch, backgroundColor: colors.pitchSoft },
  text: { flex: 1 },
  label: { color: colors.ink, fontWeight: "800" },
  detail: { marginTop: 3, color: colors.muted },
  check: { color: colors.pitch, fontSize: 20, fontWeight: "900" }
});
