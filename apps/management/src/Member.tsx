import { useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { useMobile } from "@ou/mobile-core";
import { Badge, Button, Busy, Choices, Screen, Section, SummaryLine, styles } from "@ou/mobile-ui";
type MemberData = { id: string; name: string; email: string | null; role: string; status: string; organizationStatus: string | null };
export function Member({ id, onBack }: { id: string; onBack(): void }) {
  const { client, workspace } = useMobile();
  const [member, setMember] = useState<MemberData | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [approveOrganization, setApproveOrganization] = useState(false);
  const [review, setReview] = useState(false);
  useEffect(() => {
    let active = true;
    void client.rpc("mobile_member", { p_program_id: workspace!.programId, p_member_id: id }).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError(loadError.message); else setMember(data as MemberData);
    });
    return () => { active = false; };
  }, [client, workspace?.programId, id]);
  async function save() {
    if (!member || pending) return;
    setPending(true); setError("");
    const result = await client.rpc("mobile_update_member", { p_program_id: workspace!.programId, p_member_id: id,
      p_role: member.role, p_status: member.status, p_approve_organization: approveOrganization });
    setPending(false);
    if (result.error) setError(result.error.message); else { Alert.alert("Membership updated"); onBack(); }
  }
  if (!member && !error) return <Busy />;
  if (member && review) return <Screen title="Review membership" onBack={pending ? undefined : () => setReview(false)}>
    <SummaryLine label="Member" value={member.name} />
    <SummaryLine label="Program" value={workspace!.programName} />
    <SummaryLine label="Program role" value={member.role} />
    <SummaryLine label="Program status" value={member.status} />
    <SummaryLine label="Organization membership" value={approveOrganization ? "Approve pending membership" : member.organizationStatus ?? "Not linked"} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Button disabled={pending} onPress={() => void save()}>{pending ? "Saving..." : "Confirm membership"}</Button>
    <Button secondary disabled={pending} onPress={() => setReview(false)}>Edit details</Button>
  </Screen>;
  return <Screen title={member?.name ?? "Membership"} onBack={pending ? undefined : onBack}>
    {member ? <>
      <Text style={styles.muted}>{member.email}</Text>
      <Section>ORGANIZATION MEMBERSHIP</Section>
      <Badge label={member.organizationStatus ?? "Not linked"} />
      <Section>PROGRAM ROLE</Section>
      <Choices options={["member", "captain", "manager"].filter((role) => role !== "manager" || ["owner", "admin"].includes(workspace!.organizationRole ?? "")).map((value) => ({ value, label: value }))} value={member.role} disabled={pending} onChange={(role) => setMember({ ...member, role })} />
      <Section>PROGRAM STATUS</Section>
      <Choices options={["active", "pending", "suspended", "rejected"].map((value) => ({ value, label: value }))} value={member.status} disabled={pending} onChange={(status) => setMember({ ...member, status })} />
      {member.organizationStatus === "pending" && ["owner", "admin"].includes(workspace!.organizationRole ?? "") ? <View style={styles.horizontal}>
        <Switch accessibilityLabel="Approve organization membership" value={approveOrganization} onValueChange={setApproveOrganization} disabled={pending} /><Text style={[styles.body, { flex: 1 }]}>Approve organization membership</Text>
      </View> : null}
      <Button disabled={pending} onPress={() => setReview(true)}>Review membership</Button>
    </> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </Screen>;
}
