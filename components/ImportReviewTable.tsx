"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { confirmWhatsAppImport, parseWhatsAppAction } from "@/lib/actions/import";
import type { ParsedWhatsAppImport, Player, PlayerAlias, Playground, Season, Session } from "@/lib/types";
import { money } from "@/lib/utils";
import { PlayerSelect } from "./FormControls";

type SessionWithPlayground = Session & { playgrounds?: { name?: string | null } | null };
type PlayerReportRow = {
  player_id: string;
  season_id: string;
  balance_amount: number | string | null;
};
type LedgerEntryRow = {
  player_id: string;
  season_id: string;
  session_id: string | null;
  type: string;
  amount: number | string | null;
  sessions_count: number | string | null;
};
type SessionChargeRow = {
  player_id: string;
  session_id: string;
  amount: number | string | null;
  original_amount?: number | string | null;
  waiver_amount?: number | string | null;
};
type SessionAttendanceRow = {
  player_id: string;
  session_id: string;
  status: string;
};

export function ImportReviewTable({
  aliases,
  ledgerEntries,
  playerReports,
  players,
  playgrounds,
  seasons,
  sessionAttendance,
  sessionCharges,
  sessions
}: {
  aliases: PlayerAlias[];
  ledgerEntries: LedgerEntryRow[];
  playerReports: PlayerReportRow[];
  players: Player[];
  playgrounds: Playground[];
  seasons: Season[];
  sessionAttendance: SessionAttendanceRow[];
  sessionCharges: SessionChargeRow[];
  sessions: SessionWithPlayground[];
}) {
  const [state, action, pending] = useActionState(parseWhatsAppAction, null as { parsed?: ParsedWhatsAppImport; error?: string } | null);
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmWhatsAppImport,
    null as { success?: boolean; message?: string; error?: string } | null
  );
  const [rawText, setRawText] = useState("");
  const parsed = state?.parsed;
  const playersByName = new Map(players.map((player) => [normalizeName(player.display_name), player.id]));
  const playersById = new Map(players.map((player) => [player.id, player]));
  const aliasesByName = new Map(aliases.map((alias) => [alias.normalized_alias, alias]));
  const parsedSeasonName = parsed?.season?.name ?? guessSeasonName(parsed);
  const parsedSessionName = parsed?.session?.name;
  const parsedSessionDate = parsed?.session?.date;
  const matchedSeasonByName = parsedSeasonName ? seasons.find((season) => normalizeName(season.name) === normalizeName(parsedSeasonName)) : undefined;
  const matchedSession = parsed ? findMatchingSession(parsed, sessions) : undefined;
  const matchedSeason =
    matchedSeasonByName
      ? matchedSeasonByName
      : matchedSession
      ? seasons.find((season) => season.id === matchedSession.season_id)
      : parsedSessionDate
        ? seasons.find((season) => dateInSeason(parsedSessionDate, season))
        : undefined;
  const shouldOfferSeasonCreate = Boolean(
    parsed && !matchedSeason && (parsed.players.length || parsed.payments.length || parsedSeasonName || parsed.season?.startDate || parsed.session?.pricePerSession)
  );
  const shouldOfferSessionCreate = Boolean(
    parsed &&
      !matchedSession &&
      parsed.importType === "session_update" &&
      (parsed.attendance.length || parsed.payments.length || parsed.goals.length || parsed.dropouts.length || parsed.teams.length || parsed.session)
  );
  const fixWarnings = parsed
    ? buildFixWarnings({
        parsed,
        matchedSeason,
        matchedSession,
        shouldOfferSeasonCreate,
        shouldOfferSessionCreate,
        parsedSeasonName
      })
    : [];
  const defaultSeasonId = matchedSeason?.id ?? (shouldOfferSeasonCreate ? "__create__" : "");
  const defaultSessionId = matchedSession?.id ?? (shouldOfferSessionCreate && parsed?.importType === "session_update" ? "__create__" : "");
  const [selectedSeasonId, setSelectedSeasonId] = useState(defaultSeasonId);
  const [selectedSessionId, setSelectedSessionId] = useState(defaultSessionId);
  const [matchSelections, setMatchSelections] = useState<Record<string, string>>({});
  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const selectedPlayground = selectedSession?.playgrounds?.name ?? selectedSession?.location ?? parsed?.session?.location ?? "";

  useEffect(() => {
    if (parsed) {
      toast.success(`Message parsed successfully via ${parserMethodLabel(parsed)}.`);
    }
    if (state?.error) {
      toast.error(state.error);
    }
  }, [parsed, state?.error]);

  useEffect(() => {
    if (confirmState?.success) {
      toast.success(confirmState.message ?? "Import confirmed successfully.");
    }
    if (confirmState?.error) {
      toast.error(confirmState.error);
    }
  }, [confirmState]);

  useEffect(() => {
    setSelectedSeasonId(defaultSeasonId);
    setSelectedSessionId(defaultSessionId);
    if (parsed) {
      setMatchSelections(Object.fromEntries(
        parsed.players.map((player) => [
          player.name,
          getDefaultMatchValue(player.name, players, playersByName, aliasesByName)
        ])
      ));
    }
  }, [defaultSeasonId, defaultSessionId, parsed?.rawText]);

  return (
    <div className="grid gap-5">
      <form action={action} className="grid gap-3">
        <textarea
          className="input min-h-56 p-3 leading-6"
          name="rawText"
          onChange={(event) => setRawText(event.target.value)}
          placeholder="Paste WhatsApp chat text here"
          required
          value={rawText}
        />
        <button className="btn-secondary w-fit" disabled={pending}>
          {pending ? "Parsing..." : "Parse draft"}
        </button>
      </form>

      {state?.error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{state.error}</p> : null}
      {confirmState?.error ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{confirmState.error}</p> : null}

      {parsed ? (
        <form action={confirmAction} className="grid gap-4">
          <input name="rawText" type="hidden" value={parsed.rawText} />
          <input name="parsedJson" type="hidden" value={JSON.stringify(parsed)} />
          <details className="panel overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">LLM/parser JSON</summary>
            <pre className="max-h-96 overflow-auto border-t border-line bg-slate-950 p-4 text-xs leading-5 text-emerald-100">
              {JSON.stringify(parsed, null, 2)}
            </pre>
          </details>
          <ParserSummary parsed={parsed} />
          <details className="panel overflow-hidden" open>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">Import target</summary>
            <div className="grid gap-3 border-t border-line p-4">
              <div>
                <h2 className="text-sm font-semibold">Detected import type</h2>
                <p className="mt-1 text-sm capitalize text-slate-600">{parsed.importType.replace("_", " ")}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Target season
                  <select
                    className="input"
                    name="seasonId"
                    onChange={(event) => setSelectedSeasonId(event.target.value)}
                    required
                    value={selectedSeasonId}
                  >
                    <option value="">Select season</option>
                    {shouldOfferSeasonCreate ? <option value="__create__">Create season: {parsedSeasonName ?? "parsed season"}</option> : null}
                    {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Target session {parsed.importType === "season_signup" ? "(optional)" : ""}
                  <select
                    className="input"
                    name="sessionId"
                    onChange={(event) => setSelectedSessionId(event.target.value)}
                    required={parsed.importType === "session_update"}
                    value={selectedSessionId}
                  >
                    <option value="">Select session</option>
                    {shouldOfferSessionCreate ? <option value="__create__">Create session: {parsedSessionName ?? parsed.session?.date ?? "parsed session"}</option> : null}
                    {sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.session_date} {session.name ? `- ${session.name}` : ""} {session.playgrounds?.name ?? session.location ? `- ${session.playgrounds?.name ?? session.location}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {parsedSeasonName || parsed.season ? (
                <p className="text-xs text-slate-500">
                  Parsed season: {parsedSeasonName ?? "Unnamed season"}
                  {matchedSeason ? ` - matched ${matchedSeason.name}` : shouldOfferSeasonCreate ? " - ready to create" : ""}
                </p>
              ) : null}
              {parsed.session?.date ? (
                <p className="text-xs text-slate-500">
                  Parsed date: {parsed.session.date}
                  {matchedSession ? ` - matched session ${matchedSession.session_date}` : " - no exact session date match found"}
                </p>
              ) : null}
              {parsed.session?.location || parsedSessionName || parsed.session?.duration ? (
                <p className="text-xs text-slate-500">
                  Parsed session: {[parsedSessionName, parsed.session?.location, parsed.session?.duration].filter(Boolean).join(" / ")}
                </p>
              ) : null}
            </div>
          </details>
          <ImpactPreview
            aliasesByName={aliasesByName}
            ledgerEntries={ledgerEntries}
            parsed={parsed}
            playerReports={playerReports}
            players={players}
            playersByName={playersByName}
            matchSelections={matchSelections}
            seasonId={selectedSeasonId === "__create__" ? undefined : selectedSeasonId}
            selectedSeason={selectedSeason}
            selectedSession={selectedSession}
            sessionAttendance={sessionAttendance}
            sessionCharges={sessionCharges}
          />
          <details className="overflow-hidden rounded border border-amber-200 bg-amber-50" open>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-amber-900">Review and fix parsed details</summary>
            <div className="grid gap-3 border-t border-amber-200 p-4">
              <h2 className="text-sm font-semibold text-amber-900">Review and fix parsed details</h2>
              <p className="mt-1 text-sm text-amber-800">
                These fields create new season/session records or update the selected existing records. Correct anything the parser missed before confirming.
              </p>
              {fixWarnings.length ? (
                <ul className="grid gap-1 text-sm text-amber-800">
                  {fixWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-amber-800">No blocking issues detected, but review these values if the message format was unusual.</p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Season name
                  <input className="input bg-white" defaultValue={selectedSeason?.name ?? parsedSeasonName ?? ""} key={`season-name-${selectedSeasonId}-${parsed.rawText.length}`} name="createSeasonName" placeholder="Season name" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Season price per session
                  <input className="input bg-white" defaultValue={selectedSeason?.price_per_session ?? parsed.season?.pricePerSession ?? parsed.session?.pricePerSession ?? ""} key={`season-price-${selectedSeasonId}-${parsed.rawText.length}`} min="0" name="createSeasonPricePerSession" placeholder="0.00" step="0.01" type="number" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Season start date
                  <input className="input bg-white" defaultValue={selectedSeason?.start_date ?? parsed.season?.startDate ?? parsed.session?.date ?? ""} key={`season-start-${selectedSeasonId}-${parsed.rawText.length}`} name="createSeasonStartDate" type="date" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Season end date
                  <input className="input bg-white" defaultValue={selectedSeason?.end_date ?? parsed.season?.endDate ?? ""} key={`season-end-${selectedSeasonId}-${parsed.rawText.length}`} name="createSeasonEndDate" type="date" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Planned sessions
                  <input className="input bg-white" defaultValue={selectedSeason?.total_planned_sessions ?? parsed.season?.totalSessions ?? parsed.session?.totalSessions ?? ""} key={`season-total-${selectedSeasonId}-${parsed.rawText.length}`} min="0" name="createSeasonTotalSessions" type="number" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Session name
                  <input className="input bg-white" defaultValue={selectedSession?.name ?? parsedSessionName ?? ""} key={`session-name-${selectedSessionId}-${parsed.rawText.length}`} name="createSessionName" placeholder="Session name" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Session date
                  <input className="input bg-white" defaultValue={selectedSession?.session_date ?? parsed.session?.date ?? ""} key={`session-date-${selectedSessionId}-${parsed.rawText.length}`} name="createSessionDate" type="date" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Playground / location
                  <input className="input bg-white" defaultValue={selectedPlayground} key={`session-location-${selectedSessionId}-${parsed.rawText.length}`} list="playground-options" name="createSessionLocation" placeholder="Location" />
                  <datalist id="playground-options">
                    {playgrounds.map((playground) => <option key={playground.id} value={playground.name} />)}
                  </datalist>
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Start time
                  <input className="input bg-white" defaultValue={selectedSession?.start_time ?? parsed.session?.startTime ?? ""} key={`session-start-${selectedSessionId}-${parsed.rawText.length}`} name="createSessionStartTime" type="time" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  End time
                  <input className="input bg-white" defaultValue={selectedSession?.end_time ?? parsed.session?.endTime ?? ""} key={`session-end-${selectedSessionId}-${parsed.rawText.length}`} name="createSessionEndTime" type="time" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Duration note
                  <input className="input bg-white" defaultValue={parsed.session?.duration ?? ""} name="createSessionDuration" placeholder="Example: 90 minutes" />
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Session price override
                  <input className="input bg-white" defaultValue={selectedSession?.price_per_session ?? parsed.session?.pricePerSession ?? ""} key={`session-price-${selectedSessionId}-${parsed.rawText.length}`} min="0" name="createSessionPricePerSession" placeholder="Optional" step="0.01" type="number" />
                </label>
              </div>
            </div>
          </details>
          <ReviewBlock
            title="Teams"
            rows={(parsed.teams ?? []).map((row) => {
              const captain = row.captainName ? `Captain: ${row.captainName}. ` : "";
              const teamName = row.name ?? row.teamName ?? row.team_name ?? row.label ?? "Unnamed team";
              return `${teamName}: ${captain}${row.players.join(", ")}`;
            })}
          />
          <ReviewBlock title="Game scores" rows={(parsed.matches ?? []).map((row) => `Game ${row.matchNumber}: ${row.teamAName} ${row.teamAScore}-${row.teamBScore} ${row.teamBName}`)} />
          <ReviewBlock title="Dropouts" rows={parsed.dropouts.map((row) => `${row.originalPlayerName}${row.replacementPlayerName ? ` -> ${row.replacementPlayerName}` : ""}`)} />
          <ReviewBlock title="Goals" rows={parsed.goals.map((row) => `${row.scorerName}${row.assistName ? ` assisted by ${row.assistName}` : ""}${row.teamName ? ` (${row.teamName})` : ""} x${row.count ?? 1}`)} />
          <details className="panel overflow-hidden" open>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">Match names</summary>
            <div className="grid gap-2 border-t border-line p-4 md:grid-cols-2">
              {[...parsed.players]
                .sort((a, b) => matchPriority(a.name, players, playersByName, aliasesByName) - matchPriority(b.name, players, playersByName, aliasesByName))
                .map((player) => {
                  const exactPlayerId = playersByName.get(normalizeName(player.name));
                  const suggestion = getPlayerSuggestion(player.name, players, playersByName, aliasesByName);
                  const matchedPlayerId = exactPlayerId ?? suggestion?.playerId;
                  const suggestedPlayer = matchedPlayerId ? playersById.get(matchedPlayerId) : undefined;
                  const isSuggested = !exactPlayerId && Boolean(suggestion);
                  const statusStyles = matchStatusStyles({ exactPlayerId, matchedPlayerId });
                  return (
                <div className={`grid gap-2 rounded-md border p-3 text-sm ${statusStyles.card}`} key={player.name}>
                  <div className={`flex flex-wrap items-center justify-between gap-2 font-medium ${statusStyles.text}`}>
                    <span>{player.name}</span>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${statusStyles.badge}`}>
                      {exactPlayerId ? "Good" : matchedPlayerId ? "Warning" : "Critical"}
                    </span>
                  </div>
                  {isSuggested && suggestedPlayer ? (
                    <p className="text-xs text-amber-800">
                      Suggested: {suggestedPlayer.display_name} {suggestion?.reason ? `(${suggestion.reason})` : ""}
                    </p>
                  ) : !matchedPlayerId ? (
                    <p className="text-xs text-rose-700">No match found. Choose an existing player, ignore this row, or allow a new player to be created.</p>
                  ) : (
                    <p className="text-xs text-emerald-700">Exact player name match found.</p>
                  )}
                  <PlayerSelect
                    emptyLabel="Create new player if not matched"
                    includeIgnore
                    name={`match_${player.name}`}
                    onChange={(value) => setMatchSelections((current) => ({ ...current, [player.name]: value }))}
                    players={players}
                    required={false}
                    value={matchSelections[player.name] ?? matchedPlayerId ?? ""}
                  />
                  {!exactPlayerId ? (
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                      <input className="h-4 w-4 rounded border-line" name={`update_name_${player.name}`} type="checkbox" value="yes" />
                      Update selected player's name to "{player.name}"
                    </label>
                  ) : null}
                  {matchedPlayerId ? (
                    <p className="text-xs text-slate-500">Confirming this match will remember "{player.name}" as an alias for future imports.</p>
                  ) : null}
                </div>
                  );
                })}
            </div>
          </details>
          {parsed.warnings.length ? <ReviewBlock title="Warnings" rows={parsed.warnings} warning /> : null}
          <button className="btn-primary w-fit" disabled={confirmPending}>
            {confirmPending ? "Confirming..." : "Confirm import"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeAliasKey(name: string) {
  return normalizeName(name).replace(/[^a-z0-9]/g, "");
}

function matchPriority(
  name: string,
  players: Player[],
  playersByName: Map<string, string>,
  aliasesByName: Map<string, PlayerAlias>
) {
  const exactPlayerId = playersByName.get(normalizeName(name));
  if (exactPlayerId) return 3;
  if (getPlayerSuggestion(name, players, playersByName, aliasesByName)) return 1;
  return 2;
}

function matchStatusStyles({
  exactPlayerId,
  matchedPlayerId
}: {
  exactPlayerId?: string;
  matchedPlayerId?: string;
}) {
  if (exactPlayerId) {
    return {
      card: "border-emerald-200 bg-emerald-50",
      text: "text-emerald-800",
      badge: "bg-emerald-100 text-emerald-800"
    };
  }
  if (matchedPlayerId) {
    return {
      card: "border-amber-200 bg-amber-50",
      text: "text-amber-900",
      badge: "bg-amber-100 text-amber-800"
    };
  }
  return {
    card: "border-rose-200 bg-rose-50",
    text: "text-rose-900",
    badge: "bg-rose-100 text-rose-800"
  };
}

function getPlayerSuggestion(
  name: string,
  players: Player[],
  playersByName: Map<string, string>,
  aliasesByName: Map<string, PlayerAlias>
) {
  const normalized = normalizeName(name);
  const exactPlayerId = playersByName.get(normalized);
  if (exactPlayerId) return { playerId: exactPlayerId, reason: "exact name" };

  const alias = aliasesByName.get(normalizeAliasKey(name));
  if (alias) return { playerId: alias.player_id, reason: `previous match: ${alias.alias_name}` };

  let best: { playerId: string; score: number; reason: string } | undefined;
  for (const player of players) {
    const playerName = normalizeName(player.display_name);
    const score = nameSimilarity(normalized, playerName);
    if (!best || score > best.score) {
      best = { playerId: player.id, score, reason: `${Math.round(score * 100)}% similar to ${player.display_name}` };
    }
  }

  return best && best.score >= 0.58 ? best : undefined;
}

function nameSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.25;
  }
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index, ...Array(b.length).fill(0)]);
  for (let column = 1; column <= b.length; column++) rows[0][column] = column;
  for (let row = 1; row <= a.length; row++) {
    for (let column = 1; column <= b.length; column++) {
      rows[row][column] =
        a[row - 1] === b[column - 1]
          ? rows[row - 1][column - 1]
          : Math.min(rows[row - 1][column - 1], rows[row][column - 1], rows[row - 1][column]) + 1;
    }
  }
  return rows[a.length][b.length];
}

function buildFixWarnings({
  parsed,
  matchedSeason,
  matchedSession,
  shouldOfferSeasonCreate,
  shouldOfferSessionCreate,
  parsedSeasonName
}: {
  parsed: ParsedWhatsAppImport;
  matchedSeason?: Season;
  matchedSession?: Session;
  shouldOfferSeasonCreate: boolean;
  shouldOfferSessionCreate: boolean;
  parsedSeasonName?: string;
}) {
  const warnings: string[] = [];

  if ((parsed.players.length || parsed.payments.length) && !matchedSeason && !shouldOfferSeasonCreate) {
    warnings.push("Target season is required. Choose an existing season, or provide season details so a new season can be created.");
  }

  if (shouldOfferSeasonCreate && !parsedSeasonName) {
    warnings.push("Season name was not detected. Enter a season name before using Create season.");
  }

  if (parsed.importType === "session_update" && !matchedSession && !shouldOfferSessionCreate) {
    warnings.push("Target session is required for attendance, payments, goals, or teams. Add a session date or choose an existing session.");
  }

  if (shouldOfferSessionCreate && !parsed.session?.date) {
    warnings.push("Session date was not detected. Enter a session date before using Create session.");
  }

  if (parsed.payments.some((payment) => payment.amount == null && payment.sessionsCovered == null)) {
    warnings.push("Some payments have no amount or session count. Review payment rows; these payments will be skipped unless the message says Sent for a selected session.");
  }

  if (parsed.goals.length && !parsed.attendance.length && !matchedSession) {
    warnings.push("Goals were detected but no session was matched. Choose or create the session so goals can be saved.");
  }

  if (!parsed.players.length && !parsed.attendance.length && !parsed.payments.length && !parsed.teams.length) {
    warnings.push("No importable player, payment, attendance, or team rows were detected. Review the WhatsApp message format before confirming.");
  }

  return warnings;
}

function guessSeasonName(parsed?: ParsedWhatsAppImport) {
  if (!parsed?.rawText || parsed.importType !== "season_signup") return undefined;
  const firstLine = parsed.rawText.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine && /\bseason\b/i.test(firstLine) ? firstLine : undefined;
}

function findMatchingSession(parsed: ParsedWhatsAppImport, sessions: SessionWithPlayground[]) {
  const parsedDate = parsed.session?.date;
  const parsedLocation = parsed.session?.location;
  const parsedName = parsed.session?.name;
  return sessions.find((session) => {
    if (parsedDate && session.session_date !== parsedDate) return false;
    if (parsedName && session.name && normalizeName(session.name) === normalizeName(parsedName)) return true;
    const sessionLocation = session.playgrounds?.name ?? session.location;
    if (parsedLocation && sessionLocation && normalizeName(sessionLocation) === normalizeName(parsedLocation)) return true;
    return Boolean(parsedDate && !parsedName && !parsedLocation);
  });
}

function dateInSeason(date: string, season: Season) {
  if (season.start_date && date < season.start_date) return false;
  if (season.end_date && date > season.end_date) return false;
  return true;
}

function parserMethodLabel(parsed: ParsedWhatsAppImport) {
  return parsed.parser?.engine === "llm" ? "LLM" : "Rule based";
}

function ParserSummary({ parsed }: { parsed: ParsedWhatsAppImport }) {
  const parser = parsed.parser ?? { engine: "rule_based" as const, provider: "rule_based" as const };
  const engineLabel = parser.engine === "llm" ? "LLM parser" : "Rule-based parser";
  const providerLabel = parser.provider === "rule_based" ? "Rule based" : parser.provider.toUpperCase();

  return (
    <details className="panel overflow-hidden" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">Parser details</summary>
      <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-3">
        <MiniSummary label="Parsed by" value={engineLabel} tone={parser.engine === "llm" ? "good" : "neutral"} />
        <MiniSummary label="Parser name" value={[providerLabel, parser.model].filter(Boolean).join(" / ")} tone={parser.fallbackUsed ? "warn" : "neutral"} />
        <MiniSummary label="Confidence" value={parsed.confidence} tone={parsed.confidence === "high" ? "good" : parsed.confidence === "medium" ? "warn" : "bad"} />
        {parser.fallbackUsed ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-3">
            The configured LLM parser was requested, but this result came from the rule-based fallback.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function ImpactPreview({
  aliasesByName,
  ledgerEntries,
  matchSelections,
  parsed,
  playerReports,
  players,
  playersByName,
  seasonId,
  selectedSeason,
  selectedSession,
  sessionAttendance,
  sessionCharges
}: {
  aliasesByName: Map<string, PlayerAlias>;
  ledgerEntries: LedgerEntryRow[];
  matchSelections: Record<string, string>;
  parsed: ParsedWhatsAppImport;
  playerReports: PlayerReportRow[];
  players: Player[];
  playersByName: Map<string, string>;
  seasonId?: string;
  selectedSeason?: Season;
  selectedSession?: SessionWithPlayground;
  sessionAttendance: SessionAttendanceRow[];
  sessionCharges: SessionChargeRow[];
}) {
  const rows = buildImpactRows({
    aliasesByName,
    ledgerEntries,
    matchSelections,
    parsed,
    playerReports,
    players,
    playersByName,
    seasonId,
    selectedSeason,
    selectedSession,
    sessionAttendance,
    sessionCharges
  });

  return (
    <details className="panel overflow-hidden" open>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">Estimated payment impact</summary>
      <div className="border-t border-line p-4">
        <h2 className="text-sm font-semibold">Estimated payment impact</h2>
        <p className="mt-1 text-sm text-slate-500">
          Based on the selected season/session and current name match selections. Review this before confirming import.
        </p>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Current</th>
                <th className="px-4 py-3">Payment added</th>
                <th className="px-4 py-3">Session charge</th>
                <th className="px-4 py-3">After import</th>
                <th className="px-4 py-3">Changed status</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.name}>
                  <td className="px-4 py-3 font-medium text-ink">
                    {row.name}
                    {row.createsNew ? <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">New player</span> : null}
                    {!row.matched ? <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Unmatched</span> : null}
                  </td>
                  <td className="px-4 py-3">{signedMoney(row.currentBalance)}</td>
                  <td className="px-4 py-3 text-emerald-700">{row.paymentAdded ? `+${money(row.paymentAdded)}` : money(0)}</td>
                  <td className={`px-4 py-3 ${row.sessionCharge < 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {row.sessionCharge > 0 ? `-${money(row.sessionCharge)}` : row.sessionCharge < 0 ? `+${money(Math.abs(row.sessionCharge))}` : money(0)}
                  </td>
                  <td className="px-4 py-3 font-semibold">{signedMoney(row.afterBalance)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${changeTone(row.changeStatus)}`}>{row.changeStatus}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.matched ? balanceTone(row.afterBalance) : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
                      {row.matched ? balanceLabel(row.afterBalance) : "Review match"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm text-slate-500">No matched players with payment or attendance impact yet.</p>
      )}
    </details>
  );
}

function buildImpactRows({
  aliasesByName,
  ledgerEntries,
  matchSelections,
  parsed,
  playerReports,
  players,
  playersByName,
  seasonId,
  selectedSeason,
  selectedSession,
  sessionAttendance,
  sessionCharges
}: {
  aliasesByName: Map<string, PlayerAlias>;
  ledgerEntries: LedgerEntryRow[];
  matchSelections: Record<string, string>;
  parsed: ParsedWhatsAppImport;
  playerReports: PlayerReportRow[];
  players: Player[];
  playersByName: Map<string, string>;
  seasonId?: string;
  selectedSeason?: Season;
  selectedSession?: SessionWithPlayground;
  sessionAttendance: SessionAttendanceRow[];
  sessionCharges: SessionChargeRow[];
}) {
  const sessionPrice = Number(selectedSession?.price_per_session ?? selectedSeason?.price_per_session ?? parsed.session?.pricePerSession ?? 0);
  const names = new Set<string>();
  parsed.players.forEach((row) => names.add(row.name));
  parsed.attendance.forEach((row) => names.add(row.playerName));
  parsed.payments.forEach((row) => names.add(row.playerName));
  parsed.dropouts.forEach((row) => {
    names.add(row.originalPlayerName);
    if (row.replacementPlayerName) names.add(row.replacementPlayerName);
  });

  return Array.from(names)
    .map((name) => {
      const match = resolvePreviewMatch(name, matchSelections, players, playersByName, aliasesByName);
      if (match.ignored) return null;
      const playerId = match.playerId;
      const currentBalance = playerId ? getCurrentBalance(playerReports, playerId, seasonId) : 0;
      const paymentAdded = estimatePaymentAdded({
        ledgerEntries,
        parsed,
        playerId,
        playerName: name,
        createsNewPlayer: match.createsNew,
        seasonId,
        sessionId: selectedSession?.id,
        sessionPrice
      });
      const sessionCharge = estimateSessionCharge({
        parsed,
        playerId,
        playerName: name,
        selectedSession,
        sessionAttendance,
        sessionCharges,
        sessionPrice,
        createsNewPlayer: match.createsNew
      });
      const afterBalance = currentBalance + paymentAdded - sessionCharge;
      return {
        name,
        currentBalance,
        paymentAdded,
        sessionCharge,
        afterBalance,
        matched: Boolean(playerId) || match.createsNew,
        createsNew: match.createsNew,
        changeStatus: impactChangeStatus({ matched: Boolean(playerId) || match.createsNew, paymentAdded, sessionCharge })
      };
    })
    .filter(Boolean) as Array<{
      name: string;
      currentBalance: number;
      paymentAdded: number;
      sessionCharge: number;
      afterBalance: number;
      matched: boolean;
      createsNew: boolean;
      changeStatus: string;
    }>;
}

function estimatePaymentAdded({
  ledgerEntries,
  parsed,
  playerId,
  playerName,
  createsNewPlayer,
  seasonId,
  sessionId,
  sessionPrice
}: {
  ledgerEntries: LedgerEntryRow[];
  parsed: ParsedWhatsAppImport;
  playerId?: string;
  playerName: string;
  createsNewPlayer: boolean;
  seasonId?: string;
  sessionId?: string;
  sessionPrice: number;
}) {
  const payment = parsed.payments.find((row) => normalizeName(row.playerName) === normalizeName(playerName));
  if (!payment || (!playerId && !createsNewPlayer)) return 0;
  const amount = Number(payment.amount ?? 0);
  const explicitAmount = amount > 0 && payment.amountSource === "player_line";
  const note = String(payment.note ?? "");
  const pendingWithoutSent = /\bpending\b/i.test(note) && !/\bsent\b/i.test(note);
  const sentWithoutAmount =
    parsed.importType === "session_update" &&
    !explicitAmount &&
    !pendingWithoutSent &&
    (/\bsent\b/i.test(note) || (payment.amountSource === "inferred_session_price" && Number(payment.sessionsCovered ?? 0) > 0));
  if (!explicitAmount && !sentWithoutAmount) return 0;

  if (playerId && sessionId && seasonId) {
    const existing = ledgerEntries.some((entry) => entry.player_id === playerId && entry.session_id === sessionId && entry.season_id === seasonId && entry.type === "payment_received");
    if (existing && !explicitAmount) return 0;
    const sessionsCovered = Number(payment.sessionsCovered ?? 0);
    const sameExplicitPayment = ledgerEntries.some(
      (entry) =>
        entry.player_id === playerId &&
        entry.session_id === sessionId &&
        entry.season_id === seasonId &&
        entry.type === "payment_received" &&
        sameMoney(entry.amount, amount) &&
        sameMoney(entry.sessions_count, sessionsCovered)
    );
    if (explicitAmount && sameExplicitPayment) return 0;
  }

  if (playerId && sentWithoutAmount && sessionId && seasonId && sessionPrice > 0) {
    const creditBeforeSession = getCreditBeforeSession(ledgerEntries, playerId, seasonId, sessionId);
    if (creditBeforeSession >= sessionPrice) return 0;
  }

  return explicitAmount ? amount : sessionPrice;
}

function estimateSessionCharge({
  parsed,
  playerId,
  playerName,
  selectedSession,
  sessionAttendance,
  sessionCharges,
  sessionPrice,
  createsNewPlayer
}: {
  parsed: ParsedWhatsAppImport;
  playerId?: string;
  playerName: string;
  selectedSession?: SessionWithPlayground;
  sessionAttendance: SessionAttendanceRow[];
  sessionCharges: SessionChargeRow[];
  sessionPrice: number;
  createsNewPlayer: boolean;
}) {
  if ((!playerId && !createsNewPlayer) || !selectedSession || !sessionPrice) return 0;
  const attendance = getImportAttendanceForPlayer(parsed.attendance, playerName);
  if (!attendance) return 0;
  if (createsNewPlayer) return ["confirmed", "played", "replacement"].includes(attendance.status) ? sessionPrice : 0;
  const existingCharge = sessionCharges.find((charge) => charge.player_id === playerId && charge.session_id === selectedSession.id);
  const existingAttendance = sessionAttendance.find((row) => row.player_id === playerId && row.session_id === selectedSession.id);
  const existingBillable = isBillableAttendanceStatus(existingAttendance?.status);
  const existingNonBillable = Boolean(existingAttendance?.status && !existingBillable);
  const billable = ["confirmed", "played", "replacement"].includes(attendance.status);
  if (billable) return existingCharge || existingBillable ? 0 : sessionPrice;
  if (existingNonBillable) return 0;
  return existingCharge || existingBillable ? -Number(existingCharge?.amount ?? sessionPrice) : 0;
}

function getImportAttendanceForPlayer(attendanceRows: ParsedWhatsAppImport["attendance"], playerName: string) {
  const rows = attendanceRows.filter((row) => normalizeName(row.playerName) === normalizeName(playerName));
  return rows.sort((left, right) => attendanceStatusPriority(right.status) - attendanceStatusPriority(left.status))[0];
}

function attendanceStatusPriority(status: string) {
  if (status === "dropped" || status === "absent" || status === "waitlisted") return 4;
  if (status === "replacement") return 3;
  if (status === "played") return 2;
  if (status === "confirmed") return 1;
  return 0;
}

function isBillableAttendanceStatus(status: string | undefined) {
  return status === "confirmed" || status === "played" || status === "replacement";
}

function getDefaultMatchedPlayerId(
  name: string,
  players: Player[],
  playersByName: Map<string, string>,
  aliasesByName: Map<string, PlayerAlias>
) {
  return playersByName.get(normalizeName(name)) ?? getPlayerSuggestion(name, players, playersByName, aliasesByName)?.playerId;
}

function getDefaultMatchValue(
  name: string,
  players: Player[],
  playersByName: Map<string, string>,
  aliasesByName: Map<string, PlayerAlias>
) {
  return getDefaultMatchedPlayerId(name, players, playersByName, aliasesByName) ?? "";
}

function resolvePreviewMatch(
  name: string,
  matchSelections: Record<string, string>,
  players: Player[],
  playersByName: Map<string, string>,
  aliasesByName: Map<string, PlayerAlias>
) {
  const selected = matchSelections[name] ?? getDefaultMatchValue(name, players, playersByName, aliasesByName);
  if (selected === "__ignore__") return { ignored: true, createsNew: false, playerId: undefined };
  if (!selected) return { ignored: false, createsNew: true, playerId: undefined };
  return { ignored: false, createsNew: false, playerId: selected };
}

function getCurrentBalance(playerReports: PlayerReportRow[], playerId: string, seasonId?: string) {
  if (!seasonId) return 0;
  const row = playerReports.find((report) => report.player_id === playerId && report.season_id === seasonId);
  return Number(row?.balance_amount ?? 0);
}

function getCreditBeforeSession(ledgerEntries: LedgerEntryRow[], playerId: string, seasonId: string, sessionId: string) {
  return ledgerEntries
    .filter((entry) => entry.player_id === playerId && entry.season_id === seasonId && entry.session_id !== sessionId)
    .reduce((total, entry) => {
      const amount = Number(entry.amount ?? 0);
      if (["payment_received", "credit_added", "credit_transferred_in"].includes(entry.type)) return total + amount;
      if (["session_used", "credit_transferred_out", "refund_paid"].includes(entry.type)) return total - amount;
      return total;
    }, 0);
}

function MiniSummary({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" | "neutral" }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "bad"
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-line bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase opacity-70">{label}</p>
      <p className="mt-1 text-sm font-semibold capitalize">{value || "-"}</p>
    </div>
  );
}

function signedMoney(value: number) {
  if (value > 0) return `+${money(value)}`;
  if (value < 0) return `-${money(Math.abs(value))}`;
  return money(0);
}

function balanceLabel(value: number) {
  if (value > 0) return `Credit ${money(value)}`;
  if (value < 0) return `Owes ${money(Math.abs(value))}`;
  return "Settled";
}

function balanceTone(value: number) {
  if (value > 0) return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (value < 0) return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function impactChangeStatus({ matched, paymentAdded, sessionCharge }: { matched: boolean; paymentAdded: number; sessionCharge: number }) {
  if (!matched) return "Needs match";
  if (paymentAdded > 0 && sessionCharge > 0) return "Payment + charge";
  if (paymentAdded > 0) return "Payment added";
  if (sessionCharge > 0) return "Charge added";
  if (sessionCharge < 0) return "Charge removed";
  return "No balance change";
}

function changeTone(status: string) {
  if (status === "Needs match") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (status === "Payment added") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (status === "Charge added") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  if (status === "Payment + charge") return "bg-sky-50 text-sky-700 ring-1 ring-sky-200";
  if (status === "Charge removed") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function sameMoney(a: number | string | null, b: number | string | null) {
  return Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.01;
}

function ReviewBlock({ title, rows, warning = false }: { title: string; rows: string[]; warning?: boolean }) {
  return (
    <details className="panel overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">{title}</summary>
      <div className="border-t border-line p-4">
        {rows.length ? (
          <ul className="grid gap-2 text-sm text-slate-700">
            {rows.map((row, index) => <li className={warning ? "text-amber-700" : ""} key={index}>{row}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">None detected.</p>
        )}
      </div>
    </details>
  );
}
