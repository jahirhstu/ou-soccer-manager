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
  "payments": [{"playerName": string, "matchedPlayerId": null, "amount": number | null, "sessionsCovered": number | null, "paymentMethod": string | null, "note": string | null, "balanceOwed": number | null, "confidence": "low" | "medium" | "high"}],
  "attendance": [{"playerName": string, "matchedPlayerId": null, "status": "confirmed" | "played" | "absent" | "dropped" | "replacement" | "waitlisted", "confidence": "low" | "medium" | "high"}],
  "dropouts": [{"originalPlayerName": string, "replacementPlayerName": string | null, "transferType": "credit_to_original_player" | "replacement_owes_original_player" | "replacement_paid_admin" | "no_credit" | "manual_adjustment" | null, "note": string | null, "confidence": "low" | "medium" | "high"}],
  "score": null | {"teamAScore": number | null, "teamBScore": number | null, "confidence": "low" | "medium" | "high"},
  "teams": [{"name": string | null, "teamName": string | null, "team_name": string | null, "label": string | null, "captainName": string | null, "score": number | null, "players": string[], "confidence": "low" | "medium" | "high"}],
  "goals": [{"scorerName": string, "assistName": string | null, "count": number | null, "team": "A" | "B" | null, "teamName": string | null, "note": string | null, "confidence": "low" | "medium" | "high"}],
  "warnings": string[]
}

Classify importType:
- season_signup: season roster/signup message with season name, season dates, total sessions, full season cost, numbered player list, season payments, partial payments, balances left.
- session_update: one session message with session name, date, duration/time, playground/location, who is in/out/played, drop-ins, session payments, score, goals, assists, dropouts, replacements.

Rules:
- Return pure JSON only. No markdown.
- Do not invent players from prose, headings, emails, locations, rules, or examples.
- Extract season.name when a season title/name is present.
- Extract session.name when a specific session/game title/name is present.
- Extract playground, field, venue, ground, or location into session.location.
- Extract duration text into session.duration when exact start/end times are not present.
- If teams are listed, populate teams with team name/label, captainName, players, and score when present. Supports 2 or 3 teams.
- For goals, include teamName when the scorer's team is known.
- For numbered roster rows, extract the player name before dash/bracket and parse payment info beside that name.
- For season_signup, put roster names in players, but do not create attendance unless one specific session is clearly described.
- For session_update, attendance applies to the selected session.
- Full-season paid amount means sessionsCovered equals totalSessions when known.
- Partial amount with pricePerSession means sessionsCovered = amount / pricePerSession rounded to 2 decimals.
- "left", "remaining", or "balance" is balanceOwed, not amount paid.
- Drop-in/session-only payment with no session count should use sessionsCovered 1.
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
    players: parsed.players ?? [],
    payments: normalizePayments(parsed.payments ?? []),
    attendance: parsed.attendance ?? [],
    dropouts: parsed.dropouts ?? [],
    score: parsed.score,
    teams: normalizeTeams(parsed.teams ?? []),
    goals: parsed.goals ?? [],
    warnings: parsed.warnings ?? []
  };
}

function normalizePayments(payments: ParsedWhatsAppImport["payments"]) {
  return payments.map((payment) => ({
    ...payment,
    paymentMethod: payment.paymentMethod || "e-transfer"
  }));
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
  if (!value) return value;
  return parseSessionDate(value) ?? value;
}

function normalizeTeams(teams: ParsedWhatsAppImport["teams"]) {
  return teams.map((team: any) => {
    const name = team.name ?? team.teamName ?? team.team_name ?? team.label;
    return {
      ...team,
      name,
      teamName: team.teamName ?? name,
      label: team.label ?? name
    };
  });
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
