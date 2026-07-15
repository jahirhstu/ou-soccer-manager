import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { colors } from "../theme";

export function WorkspaceSwitcher({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { profile, organizations, programs, activeProgram, selectOrganization, selectProgram } = useAuth();
  if (!profile) return null;
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Workspace</Text>
          <Pressable onPress={onClose}><Text style={styles.done}>Done</Text></Pressable>
        </View>
        <Text style={styles.section}>Organization</Text>
        {organizations.map((organization) => {
          const selected = organization.id === profile.organizationId;
          return (
            <Pressable key={organization.id} onPress={async () => { await selectOrganization(organization.id); }} style={[styles.option, selected && styles.selected]}>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>{organization.name}</Text>
                <Text style={styles.optionSubtitle}>{organization.role}</Text>
              </View>
              <Text style={styles.check}>{selected ? "✓" : ""}</Text>
            </Pressable>
          );
        })}
        <Text style={styles.section}>Program</Text>
        {programs.length === 0 ? <Text style={styles.empty}>This organization has no programs.</Text> : null}
        {programs.map((program) => {
          const selected = program.id === activeProgram?.id;
          return (
            <Pressable key={program.id} onPress={() => void selectProgram(program.id)} style={[styles.option, selected && styles.selected]}>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>{program.name}</Text>
                <Text style={styles.optionSubtitle}>{program.category}</Text>
              </View>
              <Text style={styles.check}>{selected ? "✓" : ""}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, backgroundColor: colors.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  title: { color: colors.ink, fontSize: 28, fontWeight: "900" },
  done: { color: colors.pitch, fontSize: 16, fontWeight: "800" },
  section: { marginTop: 20, marginBottom: 8, color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  option: { minHeight: 68, marginBottom: 9, padding: 14, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.surface },
  selected: { borderColor: colors.pitch, backgroundColor: colors.pitchSoft },
  optionText: { flex: 1 },
  optionTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  optionSubtitle: { marginTop: 3, color: colors.muted, textTransform: "capitalize" },
  check: { color: colors.pitch, fontSize: 22, fontWeight: "900" },
  empty: { color: colors.muted }
});
