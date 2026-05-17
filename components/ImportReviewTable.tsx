"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { confirmWhatsAppImport, parseWhatsAppAction } from "@/lib/actions/import";
import type { ParsedWhatsAppImport, Player, PlayerAlias, Playground, Season, Session } from "@/lib/types";
import { PlayerSelect } from "./FormControls";

type SessionWithPlayground = Session & { playgrounds?: { name?: string | null } | null };

export function ImportReviewTable({
  aliases,
  players,
  playgrounds,
  seasons,
  sessions
}: {
  aliases: PlayerAlias[];
  players: Player[];
  playgrounds: Playground[];
  seasons: Season[];
  sessions: SessionWithPlayground[];
}) {
  const [state, action, pending] = useActionState(parseWhatsAppAction, null as { parsed?: ParsedWhatsAppImport; error?: string } | null);
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmWhatsAppImport,
    null as { success?: boolean; message?: string; error?: string } | null
  );
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
  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const selectedPlayground = selectedSession?.playgrounds?.name ?? selectedSession?.location ?? parsed?.session?.location ?? "";

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
  }, [defaultSeasonId, defaultSessionId, parsed?.rawText]);

  return (
    <div className="grid gap-5">
      <form action={action} className="grid gap-3">
        <textarea className="input min-h-56 p-3 leading-6" name="rawText" placeholder="Paste WhatsApp chat text here" required />
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
          <div className="panel grid gap-3 p-4">
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
          <section className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-4">
            <div>
              <h2 className="text-sm font-semibold text-amber-900">Review and fix parsed details</h2>
              <p className="mt-1 text-sm text-amber-800">
                These fields create new season/session records or update the selected existing records. Correct anything the parser missed before confirming.
              </p>
            </div>
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
          </section>
          <ReviewBlock title="Players" rows={parsed.players.map((row) => `${row.name}${row.matchedPlayerId ? "" : " - will create if not matched"}`)} />
          <ReviewBlock title="Payments" rows={parsed.payments.map((row) => `${row.playerName}: $${row.amount ?? "?"} / ${row.sessionsCovered ?? "?"} sessions${row.balanceOwed ? ` / owes $${row.balanceOwed}` : ""}`)} />
          <ReviewBlock title="Attendance" rows={parsed.attendance.map((row) => `${row.playerName}: ${row.status}`)} />
          <ReviewBlock
            title="Teams"
            rows={(parsed.teams ?? []).map((row) => {
              const captain = row.captainName ? `Captain: ${row.captainName}. ` : "";
              const teamName = row.name ?? row.teamName ?? row.team_name ?? row.label ?? "Unnamed team";
              return `${teamName}${row.score == null ? "" : ` (${row.score})`}: ${captain}${row.players.join(", ")}`;
            })}
          />
          <ReviewBlock title="Dropouts" rows={parsed.dropouts.map((row) => `${row.originalPlayerName}${row.replacementPlayerName ? ` -> ${row.replacementPlayerName}` : ""}`)} />
          <ReviewBlock title="Goals" rows={parsed.goals.map((row) => `${row.scorerName}${row.assistName ? ` assisted by ${row.assistName}` : ""}${row.teamName ? ` (${row.teamName})` : ""} x${row.count ?? 1}`)} />
          <div className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">Match names</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {[...parsed.players]
                .sort((a, b) => Number(Boolean(getSuggestedPlayerId(a.name, players, playersByName, aliasesByName))) - Number(Boolean(getSuggestedPlayerId(b.name, players, playersByName, aliasesByName))))
                .map((player) => {
                  const exactPlayerId = playersByName.get(normalizeName(player.name));
                  const suggestion = getPlayerSuggestion(player.name, players, playersByName, aliasesByName);
                  const matchedPlayerId = exactPlayerId ?? suggestion?.playerId;
                  const suggestedPlayer = matchedPlayerId ? playersById.get(matchedPlayerId) : undefined;
                  const isSuggested = !exactPlayerId && Boolean(suggestion);
                  return (
                <div className={`grid gap-2 rounded-md border p-3 text-sm ${exactPlayerId ? "border-emerald-200 bg-emerald-50" : matchedPlayerId ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50"}`} key={player.name}>
                  <div className={exactPlayerId ? "font-medium text-emerald-800" : matchedPlayerId ? "font-medium text-sky-800" : "font-medium text-amber-800"}>
                    {player.name} {exactPlayerId ? "matched" : matchedPlayerId ? "suggested" : "unmatched"}
                  </div>
                  {isSuggested && suggestedPlayer ? (
                    <p className="text-xs text-sky-700">
                      Suggested: {suggestedPlayer.display_name} {suggestion?.reason ? `(${suggestion.reason})` : ""}
                    </p>
                  ) : null}
                  <PlayerSelect
                    defaultValue={matchedPlayerId}
                    emptyLabel="Create new player if not matched"
                    includeIgnore
                    name={`match_${player.name}`}
                    players={players}
                    required={false}
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
          </div>
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

function getSuggestedPlayerId(
  name: string,
  players: Player[],
  playersByName: Map<string, string>,
  aliasesByName: Map<string, PlayerAlias>
) {
  return getPlayerSuggestion(name, players, playersByName, aliasesByName)?.playerId;
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

function ReviewBlock({ title, rows, warning = false }: { title: string; rows: string[]; warning?: boolean }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length ? (
        <ul className="grid gap-2 text-sm text-slate-700">
          {rows.map((row, index) => <li className={warning ? "text-amber-700" : ""} key={index}>{row}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">None detected.</p>
      )}
    </section>
  );
}
