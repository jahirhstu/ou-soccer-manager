import type { ParsedWhatsAppImport } from "../types";
import { parseSessionDate } from "../utils";

export function parserInstructions() {
  const currentYear = new Date().getFullYear();
  return `Parse this WhatsApp message for a small recurring soccer group and return only JSON matching this TypeScript shape:

{
  "rawText": string,
  "importType": "season_signup" | "session_update",
  "confidence": "low" | "medium" | "high",
  "season": null | {
    "name": string | null,
    "startDate": string | null,
    "endDate": string | null,
    "totalSessions": number | null,
    "pricePerSession": number | null
  },
  "session": null | {
    "name": string | null,
    "date": string | null,
    "location": string | null,
    "startTime": string | null,
    "endTime": string | null,
    "duration": string | null,
    "totalSessions": number | null,
    "pricePerSession": number | null,
    "fullSeasonCost": number | null
  },
  "players": [{"name": string, "matchedPlayerId": null, "confidence": "low" | "medium" | "high"}],
  "payments": [{"playerName": string, "matchedPlayerId": null, "amount": number | null, "sessionsCovered": number | null, "paymentMethod": string | null, "note": string | null, "balanceOwed": number | null, "amountSource": "player_line" | "inferred_session_price" | "general_context" | null, "confidence": "low" | "medium" | "high"}],
  "attendance": [{"playerName": string, "matchedPlayerId": null, "status": "confirmed" | "played" | "absent" | "dropped" | "replacement" | "waitlisted", "confidence": "low" | "medium" | "high"}],
  "dropouts": [{"originalPlayerName": string, "replacementPlayerName": string | null, "transferType": "credit_to_original_player" | "replacement_owes_original_player" | "replacement_paid_admin" | "no_credit" | "manual_adjustment" | null, "note": string | null, "confidence": "low" | "medium" | "high"}],
  "teams": [{"name": string | null, "teamName": string | null, "team_name": string | null, "label": string | null, "captainName": string | null, "players": string[], "confidence": "low" | "medium" | "high"}],
  "matches": [{"matchNumber": number, "teamAName": string, "teamBName": string, "teamAScore": number, "teamBScore": number, "confidence": "low" | "medium" | "high"}],
  "goals": [{"scorerName": string, "assistName": string | null, "count": number | null, "team": "A" | "B" | null, "teamName": string | null, "note": string | null, "confidence": "low" | "medium" | "high"}],
  "warnings": string[]
}

Classify importType:
- season_signup: season roster/signup message with season name, season dates, total sessions, full season cost, numbered player list, season payments, partial payments, balances left.
- session_update: one session message with session name, date, duration/time, playground/location, who is in/out/played, drop-ins, session payments, mini-game scores, goals, assists, dropouts, replacements.

Rules:
- Return pure JSON only. No markdown.
- Do not invent players from prose, headings, emails, locations, rules, or examples.
- Extract season.name when a season title/name is present.
- Extract session.name when a specific session/game title/name is present.
- Extract playground, field, venue, ground, or location into session.location.
- Extract duration text into session.duration when exact start/end times are not present.
- If teams are listed, populate teams with team name/label, captainName, and players. Supports 2 or 3 teams.
- If mini-games are listed like "Game 1: Team A 2 - 1 Team B", populate matches. A session can contain multiple games.
- For goals, include teamName when the scorer's team is known.
- For numbered roster rows, extract the player name before dash/bracket and parse payment info beside that name.
- Parenthesized words like "(Sent)", "(Pending)", "(Dropped)", "(Replaced)", or "(Balance will remain)" are status/payment notes, not part of the player name.
- In roster/headcount rows, "(Pending)" usually means payment pending, not waitlisted. Keep attendance confirmed unless the row explicitly says waitlist/waitlisted.
- Numbered names under a "Waitlist", "Wait list", or "Waiting list" section must be players and attendance with status "waitlisted", not confirmed.
- For season_signup, put roster names in players, but do not create attendance unless one specific session is clearly described.
- For session_update, attendance applies to the selected session.
- Full-season paid amount means sessionsCovered equals totalSessions when known.
- Partial amount with pricePerSession means sessionsCovered = amount / pricePerSession rounded to 2 decimals.
- "left", "remaining", or "balance" is balanceOwed, not amount paid.
- Only set payment.amount when an amount is written beside that specific player's name, such as "Jahir - Payment $30", "Jahir ($30 sent)", or "Mim - 70 paid". Set amountSource to "player_line" for those.
- Do not copy general amounts from lines like "12$ for drop ins", "Please pay $12", "Cost per session $12", "Interac", or "Full season cost $192" into each player's payment.amount. Those are general context, not individual payments.
- For "Sent" beside a player with no amount, set amount null, sessionsCovered 1, amountSource "inferred_session_price".
- Drop-in/session-only payment with no session count should use sessionsCovered 1, but only use amount when it is beside the player name.
- Use confidence low/medium/high per extracted row.
- Add warnings for ambiguity.
- Clean names, e.g. "rocky bhai" -> "Rocky Bhai".
- Return dates as YYYY-MM-DD. If a date has month/day but no year, use current year ${currentYear}.`;
}

export function normalizeParsedJson(value: any, rawText: string): ParsedWhatsAppImport {
  const parsed = stripNulls(value) as ParsedWhatsAppImport;
  return {
    rawText,
    importType: parsed.importType ?? "session_update",
    confidence: parsed.confidence ?? "medium",
    season: normalizeSeasonDates(parsed.season),
    session: normalizeSessionDate(parsed.session),
    players: normalizePlayers(parsed.players ?? []),
    payments: normalizePayments(parsed.payments ?? []),
    attendance: normalizeAttendance(parsed.attendance ?? []),
    dropouts: normalizeDropouts(parsed.dropouts ?? []),
    teams: normalizeTeams(parsed.teams ?? []),
    matches: normalizeMatches(parsed.matches ?? []),
    goals: parsed.goals ?? [],
    warnings: parsed.warnings ?? []
  };
}

function normalizePayments(payments: ParsedWhatsAppImport["payments"]) {
  return payments.map((payment) => ({
    ...payment,
    playerName: cleanImportedName(payment.playerName),
    amountSource: normalizeAmountSource(payment),
    paymentMethod: payment.paymentMethod || "e-transfer"
  }));
}

function normalizePlayers(players: ParsedWhatsAppImport["players"]) {
  return players.map((player) => ({ ...player, name: cleanImportedName(player.name) })).filter((player) => player.name);
}

function normalizeAttendance(rows: ParsedWhatsAppImport["attendance"]) {
  return rows.map((row) => ({ ...row, playerName: cleanImportedName(row.playerName) })).filter((row) => row.playerName);
}

function normalizeDropouts(rows: ParsedWhatsAppImport["dropouts"]) {
  return rows
    .map((row) => ({
      ...row,
      originalPlayerName: cleanImportedName(row.originalPlayerName),
      replacementPlayerName: row.replacementPlayerName ? cleanImportedName(row.replacementPlayerName) : undefined
    }))
    .filter((row) => row.originalPlayerName);
}

function cleanImportedName(name: string | null | undefined) {
  return String(name ?? "")
    .replace(/\((?:sent|pending|dropped|replaced|replacement|balance will remain)\)/gi, " ")
    .replace(/\b(?:sent|pending|dropped|replaced|replacement|balance will remain)\b/gi, " ")
    .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAmountSource(payment: ParsedWhatsAppImport["payments"][number]) {
  if (payment.amount && payment.note && playerLineHasPaymentAmount(payment.note)) return "player_line";
  if (/\bsent\b/i.test(payment.note ?? "")) return "inferred_session_price";
  if (payment.amountSource) return payment.amountSource;
  return payment.amount ? "general_context" : undefined;
}

function playerLineHasPaymentAmount(note: string) {
  if (/\b(?:drop-?ins?|cost per session|full season|remaining balance|please pay|please e-?transfer|interac|for players who already paid)\b/i.test(note)) return false;
  return /\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:cad\s*)?(?:paid|sent|payment|e-?transfer|cash|bank)\b|\b(?:paid|sent|payment|e-?transfer|cash|bank)\b\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i.test(note);
}

function normalizeSeasonDates(season: ParsedWhatsAppImport["season"]) {
  if (!season) return season;
  return {
    ...season,
    startDate: normalizeDate(season.startDate),
    endDate: normalizeDate(season.endDate)
  };
}

function normalizeSessionDate(session: ParsedWhatsAppImport["session"]) {
  if (!session) return session;
  return {
    ...session,
    date: normalizeDate(session.date)
  };
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return undefined;
  return parseSessionDate(value) ?? value;
}

function normalizeTeams(teams: ParsedWhatsAppImport["teams"]) {
  return teams.map((team: any) => {
    const name = team.name ?? team.teamName ?? team.team_name ?? team.label;
    return {
      ...team,
      name,
      teamName: team.teamName ?? name,
      label: team.label ?? name,
      captainName: team.captainName ? cleanImportedName(team.captainName) : undefined,
      players: (team.players ?? []).map(cleanImportedName).filter(Boolean)
    };
  });
}

function normalizeMatches(matches: ParsedWhatsAppImport["matches"]) {
  return matches
    .map((match) => ({
      ...match,
      matchNumber: Number(match.matchNumber),
      teamAName: String(match.teamAName ?? "").trim(),
      teamBName: String(match.teamBName ?? "").trim(),
      teamAScore: Number(match.teamAScore),
      teamBScore: Number(match.teamBScore),
      confidence: match.confidence ?? "medium"
    }))
    .filter((match) =>
      Number.isFinite(match.matchNumber) &&
      match.teamAName &&
      match.teamBName &&
      Number.isFinite(match.teamAScore) &&
      Number.isFinite(match.teamBScore)
    )
    .sort((left, right) => left.matchNumber - right.matchNumber);
}

export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null)
      .map(([key, entryValue]) => [key, stripNulls(entryValue)])
  );
}

export function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM response did not contain a JSON object.");
  return match[0];
}
