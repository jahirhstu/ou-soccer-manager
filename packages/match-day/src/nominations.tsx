import { useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { accountLoadError, nomineeSelectedInAnotherCategory, nominationCategories, type NominationCategory, type PerformanceData } from "@ou/contracts";
import { useMobile } from "@ou/mobile-core";
import { Button, Choices, Row, Section, styles } from "@ou/mobile-ui";

export function SessionNominations({
  data,
  sessionId,
  onSaved
}: {
  data: PerformanceData;
  sessionId: string;
  onSaved(): void;
}) {
  const { client } = useMobile();
  const [selected, setSelected] = useState<Partial<Record<NominationCategory, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const completedCategories = new Set((data.nominations ?? []).map(nomination => nomination.category));
  const hasPlayedFixture = data.matches.some(match => match.status === "played");
  const canNominate = Boolean(data.canNominate) && !data.closed && data.session.status !== "completed" && hasPlayedFixture;
  const nominees = [...new Map(data.teams.flatMap(team => team.players)
    .filter(player => player.id !== data.voterPlayerId)
    .map(player => [player.id, player])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));

  async function submitNominations() {
    const pendingCategories = nominationCategories.filter(category => selected[category] && !completedCategories.has(category));
    if (busy || !pendingCategories.length) return;
    setBusy(true);
    setMessage("");
    let saved = 0;
    try {
      for (const category of pendingCategories) {
        const result = await client.rpc("submit_session_performance_nomination", {
          p_session_id: sessionId,
          p_category: category,
          p_player_id: selected[category]
        });
        if (result.error) throw result.error;
        saved += 1;
        setSelected(current => ({ ...current, [category]: "" }));
      }
      Alert.alert("Nominations saved");
    } catch (cause) {
      setMessage(accountLoadError(cause));
    } finally {
      setBusy(false);
      if (saved) onSaved();
    }
  }

  async function updateVoter(playerId: string, authorized: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await client.rpc("authorize_session_performance_nominator", {
        p_session_id: sessionId,
        p_player_id: playerId,
        p_authorized: authorized
      });
      if (result.error) throw result.error;
      onSaved();
    } catch (cause) {
      setMessage(accountLoadError(cause));
    } finally {
      setBusy(false);
    }
  }

  function toggleVoting() {
    const closed = !data.closed;
    Alert.alert(closed ? "Close nominations?" : "Reopen nominations?", "This change is recorded for the session.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: () => {
          void (async () => {
            setBusy(true);
            setMessage("");
            try {
              const result = await client.rpc("close_performance_voting", {
                p_session_id: sessionId,
                p_closed: closed
              });
              if (result.error) throw result.error;
              onSaved();
            } catch (cause) {
              setMessage(accountLoadError(cause));
            } finally {
              setBusy(false);
            }
          })();
        }
      }
    ]);
  }

  const nominationStatus = data.closed
    ? "Nominations are closed."
    : data.session.status === "completed"
      ? "Nominations are read-only for completed sessions."
      : hasPlayedFixture
        ? "Nominations are open."
        : "Nominations open after a fixture is marked played.";

  return <View style={{ gap: 12 }}>
    <Section>Nominations</Section>
    <Text style={styles.muted}>{nominationStatus} Each category awards up to 60 points, with a maximum of 20 points per nomination.</Text>
    {data.canNominate ? <Text style={styles.muted}>
      Voting as {data.voters?.find(voter => voter.playerId === data.voterPlayerId)?.name ?? "your linked player profile"}.
    </Text> : null}
    {!data.canNominate && !data.canAuthorizeVoters && hasPlayedFixture && !data.closed && data.session.status !== "completed"
      ? <Text style={styles.muted}>An active participating player profile or manager authorization is required to nominate.</Text>
      : null}

    {nominationCategories.map(category => {
      const recorded = (data.nominations ?? []).find(nomination => nomination.category === category);
      const recordedName = nominees.find(player => player.id === recorded?.player_id)?.name ?? "Player";
      const options = nominees
        .filter(player => !nomineeSelectedInAnotherCategory(player.id, category, data.nominations, selected))
        .map(player => ({ value: player.id, label: player.name }));
      return <View key={category} style={styles.row}>
        <Text style={styles.title}>{`Top ${category[0].toUpperCase()}${category.slice(1)}`}</Text>
        {recorded
          ? <Text style={styles.muted}>{`Recorded: ${recordedName}`}</Text>
          : <Choices
              disabled={!canNominate || busy}
              value={selected[category] ?? ""}
              onChange={playerId => setSelected(current => ({ ...current, [category]: playerId }))}
              options={[{ value: "", label: "No selection" }, ...options]}
            />}
      </View>;
    })}
    <Text style={styles.muted}>Choose one player in each category. A player can only be nominated in one category by each voter.</Text>
    {canNominate ? <Button disabled={busy || !nominationCategories.some(category => selected[category] && !completedCategories.has(category))} onPress={() => void submitNominations()}>
      {busy ? "Saving..." : "Submit nominations"}
    </Button> : null}
    {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}

    {data.canClose && hasPlayedFixture && data.session.status !== "completed" ? <Button secondary disabled={busy} onPress={toggleVoting}>
      {data.closed ? "Reopen nominations" : "Close nominations"}
    </Button> : null}

    {data.canAuthorizeVoters && hasPlayedFixture && data.session.status !== "completed" && !data.closed
      ? <View>
          <Section>Authorize nonparticipants</Section>
          <Text style={styles.muted}>Authorized players need an active player-linked program account.</Text>
          {(data.voters ?? []).filter(voter => !voter.participated).map(voter => <View key={voter.playerId} style={styles.horizontal}>
            <Row title={voter.name} subtitle={voter.authorized ? "Authorized" : "Not authorized"} />
            <Switch
              accessibilityLabel={`Authorize ${voter.name} to nominate`}
              disabled={busy}
              value={voter.authorized}
              onValueChange={authorized => void updateVoter(voter.playerId, authorized)}
            />
          </View>)}
          {!(data.voters ?? []).some(voter => !voter.participated) ? <Text style={styles.muted}>There are no nonparticipant program players to authorize.</Text> : null}
        </View>
      : null}
  </View>;
}
