import type { ParsedWhatsAppImport } from "../types";
import { parseSessionDate } from "../utils";
import { RuleBasedWhatsAppParser } from "./rule-based";
import type { WhatsAppParser } from "./types";

export class GeminiWhatsAppParser implements WhatsAppParser {
  private fallback = new RuleBasedWhatsAppParser();

  async parse(input: string): Promise<ParsedWhatsAppImport> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const parsed = await this.fallback.parse(input);
      parsed.warnings.unshift("Gemini parser requested but GEMINI_API_KEY is missing. Used rule-based parser.");
      parsed.confidence = parsed.confidence === "high" ? "medium" : parsed.confidence;
      return parsed;
    }

    try {
      const { payload, model } = await generateWithModelFallback({
        apiKey,
        input,
        models: getCandidateModels()
      });
      const text = extractGeminiText(payload);
      if (!text) throw new Error(`Gemini parser returned no text from ${model}.`);

      return normalizeParsedJson(JSON.parse(text), input);
    } catch (error) {
      const parsed = await this.fallback.parse(input);
      parsed.warnings.unshift(`Gemini parser failed. Used rule-based parser. ${error instanceof Error ? error.message : ""}`.trim());
      parsed.confidence = "low";
      return parsed;
    }
  }
}

async function generateWithModelFallback({ apiKey, input, models }: { apiKey: string; input: string; models: string[] }) {
  const errors: string[] = [];
  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${parserInstructions()}\n\nWhatsApp message:\n${input}` }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: geminiParsedWhatsAppImportSchema
          }
        })
      });

    if (response.ok) {
      return { payload: await response.json(), model };
    }

    const body = await response.text();
    errors.push(`${model}: ${response.status} ${body}`);
    if (![404, 429, 503].includes(response.status)) break;
  }

  throw new Error(errors.join(" | "));
}

function getCandidateModels() {
  const configured = process.env.GEMINI_WHATSAPP_PARSER_MODEL?.trim();
  const defaults = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-flash-latest",
    "gemini-1.5-flash-latest"
  ];
  return Array.from(new Set([configured, ...defaults].filter(Boolean) as string[]));
}

export async function listGeminiModels(apiKey = process.env.GEMINI_API_KEY) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey }
  });
  if (!response.ok) throw new Error(`Gemini list models failed: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return (payload.models ?? [])
    .filter((model: any) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model: any) => model.name?.replace(/^models\//, ""))
    .filter(Boolean);
}

function parserInstructions() {
  const currentYear = new Date().getFullYear();
  return `Parse this WhatsApp message for a small recurring soccer group and return only JSON matching the schema.

Classify importType:
- season_signup: season roster/signup message with season name, season dates, total sessions, full season cost, numbered player list, season payments, partial payments, balances left.
- session_update: one session message with session name, date, duration/time, playground/location, who is in/out/played, 2 or 3 teams, mini-game scores, drop-ins, session payments, goals, assists, dropouts, replacements.

Rules:
- Do not invent players from prose, headings, emails, locations, rules, or examples.
- Extract season.name when a season title/name is present.
- Extract session.name when a specific session/game title/name is present.
- Extract playground, field, venue, ground, or location into session.location.
- Extract duration text into session.duration when exact start/end times are not present.
- If teams are listed, extract each team with its optional teamName/team_name, captain, and players.
- If mini-games are listed like "Game 1: Team A 2 - 1 Team B", extract them into matches. A session can contain multiple games.
- For each goal, include teamName when the scorer's team is known.
- For numbered roster rows, extract the player name before dash/bracket and parse payment info beside that name.
- Parenthesized words like "(Sent)", "(Pending)", "(Dropped)", "(Replaced)", or "(Balance will remain)" are status/payment notes, not part of the player name.
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

function extractGeminiText(payload: any) {
  return payload.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("").trim();
}

function normalizeParsedJson(value: any, rawText: string): ParsedWhatsAppImport {
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

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null)
      .map(([key, entryValue]) => [key, stripNulls(entryValue)])
  );
}

const confidenceSchema = { type: "string", enum: ["low", "medium", "high"] };
const nullableString = { type: "string", nullable: true };
const nullableNumber = { type: "number", nullable: true };
const nullableAmountSource = { type: "string", nullable: true, enum: ["player_line", "inferred_session_price", "general_context"] };

const geminiParsedWhatsAppImportSchema = {
  type: "object",
  required: ["rawText", "importType", "confidence", "season", "session", "players", "payments", "attendance", "dropouts", "teams", "matches", "goals", "warnings"],
  propertyOrdering: ["rawText", "importType", "confidence", "season", "session", "players", "payments", "attendance", "dropouts", "teams", "matches", "goals", "warnings"],
  properties: {
    rawText: { type: "string" },
    importType: { type: "string", enum: ["season_signup", "session_update"] },
    confidence: confidenceSchema,
    season: {
      type: "object",
      nullable: true,
      required: ["name", "startDate", "endDate", "totalSessions", "pricePerSession"],
      propertyOrdering: ["name", "startDate", "endDate", "totalSessions", "pricePerSession"],
      properties: {
        name: nullableString,
        startDate: nullableString,
        endDate: nullableString,
        totalSessions: nullableNumber,
        pricePerSession: nullableNumber
      }
    },
    session: {
      type: "object",
      nullable: true,
      required: ["name", "date", "location", "startTime", "endTime", "duration", "totalSessions", "pricePerSession", "fullSeasonCost"],
      propertyOrdering: ["name", "date", "location", "startTime", "endTime", "duration", "totalSessions", "pricePerSession", "fullSeasonCost"],
      properties: {
        name: nullableString,
        date: nullableString,
        location: nullableString,
        startTime: nullableString,
        endTime: nullableString,
        duration: nullableString,
        totalSessions: nullableNumber,
        pricePerSession: nullableNumber,
        fullSeasonCost: nullableNumber
      }
    },
    players: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "matchedPlayerId", "confidence"],
        propertyOrdering: ["name", "matchedPlayerId", "confidence"],
        properties: {
          name: { type: "string" },
          matchedPlayerId: nullableString,
          confidence: confidenceSchema
        }
      }
    },
    payments: {
      type: "array",
      items: {
        type: "object",
        required: ["playerName", "matchedPlayerId", "amount", "sessionsCovered", "paymentMethod", "note", "balanceOwed", "amountSource", "confidence"],
        propertyOrdering: ["playerName", "matchedPlayerId", "amount", "sessionsCovered", "paymentMethod", "note", "balanceOwed", "amountSource", "confidence"],
        properties: {
          playerName: { type: "string" },
          matchedPlayerId: nullableString,
          amount: nullableNumber,
          sessionsCovered: nullableNumber,
          paymentMethod: nullableString,
          note: nullableString,
          balanceOwed: nullableNumber,
          amountSource: nullableAmountSource,
          confidence: confidenceSchema
        }
      }
    },
    attendance: {
      type: "array",
      items: {
        type: "object",
        required: ["playerName", "matchedPlayerId", "status", "confidence"],
        propertyOrdering: ["playerName", "matchedPlayerId", "status", "confidence"],
        properties: {
          playerName: { type: "string" },
          matchedPlayerId: nullableString,
          status: { type: "string", enum: ["confirmed", "played", "absent", "dropped", "replacement", "waitlisted"] },
          confidence: confidenceSchema
        }
      }
    },
    dropouts: {
      type: "array",
      items: {
        type: "object",
        required: ["originalPlayerName", "replacementPlayerName", "transferType", "note", "confidence"],
        propertyOrdering: ["originalPlayerName", "replacementPlayerName", "transferType", "note", "confidence"],
        properties: {
          originalPlayerName: { type: "string" },
          replacementPlayerName: nullableString,
          transferType: {
            type: "string",
            nullable: true,
            enum: ["credit_to_original_player", "replacement_owes_original_player", "replacement_paid_admin", "no_credit", "manual_adjustment"]
          },
          note: nullableString,
          confidence: confidenceSchema
        }
      }
    },
    teams: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "teamName", "team_name", "label", "captainName", "players", "confidence"],
        propertyOrdering: ["name", "teamName", "team_name", "label", "captainName", "players", "confidence"],
        properties: {
          name: nullableString,
          teamName: nullableString,
          team_name: nullableString,
          label: nullableString,
          captainName: nullableString,
          players: { type: "array", items: { type: "string" } },
          confidence: confidenceSchema
        }
      }
    },
    matches: {
      type: "array",
      items: {
        type: "object",
        required: ["matchNumber", "teamAName", "teamBName", "teamAScore", "teamBScore", "confidence"],
        propertyOrdering: ["matchNumber", "teamAName", "teamBName", "teamAScore", "teamBScore", "confidence"],
        properties: {
          matchNumber: { type: "number" },
          teamAName: { type: "string" },
          teamBName: { type: "string" },
          teamAScore: { type: "number" },
          teamBScore: { type: "number" },
          confidence: confidenceSchema
        }
      }
    },
    goals: {
      type: "array",
      items: {
        type: "object",
        required: ["scorerName", "assistName", "count", "team", "teamName", "note", "confidence"],
        propertyOrdering: ["scorerName", "assistName", "count", "team", "teamName", "note", "confidence"],
        properties: {
          scorerName: { type: "string" },
          assistName: nullableString,
          count: nullableNumber,
          team: { type: "string", nullable: true, enum: ["A", "B"] },
          teamName: nullableString,
          note: nullableString,
          confidence: confidenceSchema
        }
      }
    },
    warnings: { type: "array", items: { type: "string" } }
  }
};
