import type { ParsedWhatsAppImport } from "../types";
import { parseSessionDate } from "../utils";
import { RuleBasedWhatsAppParser } from "./rule-based";
import type { WhatsAppParser } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export class OpenAIWhatsAppParser implements WhatsAppParser {
  private fallback = new RuleBasedWhatsAppParser();

  async parse(input: string): Promise<ParsedWhatsAppImport> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const parsed = await this.fallback.parse(input);
      parsed.warnings.unshift("OpenAI parser requested but OPENAI_API_KEY is missing. Used rule-based parser.");
      parsed.confidence = parsed.confidence === "high" ? "medium" : parsed.confidence;
      return parsed;
    }

    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OPENAI_WHATSAPP_PARSER_MODEL ?? "gpt-4.1-mini",
          input: [
            {
              role: "system",
              content: parserInstructions()
            },
            {
              role: "user",
              content: input
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "parsed_whatsapp_import",
              strict: true,
              schema: parsedWhatsAppImportJsonSchema
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI parser failed: ${response.status} ${await response.text()}`);
      }

      const payload = await response.json();
      const text = extractResponseText(payload);
      if (!text) throw new Error("OpenAI parser returned no structured text.");

      return normalizeParsedJson(JSON.parse(text), input);
    } catch (error) {
      const parsed = await this.fallback.parse(input);
      parsed.warnings.unshift(`OpenAI parser failed. Used rule-based parser. ${error instanceof Error ? error.message : ""}`.trim());
      parsed.confidence = "low";
      return parsed;
    }
  }
}

function parserInstructions() {
  const currentYear = new Date().getFullYear();
  return `You parse WhatsApp messages for a small recurring soccer group.

Return only data that is explicitly present or strongly implied.

Classify importType:
- season_signup: a season signup/roster message, usually includes season name, season dates, total sessions, full season cost, numbered player list, season payments, partial payments, balances left.
- session_update: a single-session message, usually includes session name, date, duration/time, playground/location, who is in/out/played, 2 or 3 teams, team scores, drop-ins, payments for one game, score, goals, assists, dropouts, replacements.

Important rules:
- Do not invent players from general prose, headings, email addresses, locations, rules, or examples.
- Extract season.name when a season title/name is present.
- Extract session.name when a specific session/game title/name is present.
- Extract playground, field, venue, ground, or location into session.location.
- Extract duration text into session.duration when exact start/end times are not present.
- If teams are listed, extract each team with its optional teamName/team_name, captain, players, and score if present.
- For each goal, include teamName when the scorer's team is known.
- For numbered roster rows, extract the name before the dash/bracket and parse payment info beside that name.
- For season_signup, list roster players in players. Do not create attendance unless the message clearly describes one specific session.
- For session_update, attendance should represent the selected session.
- If a player paid the full season amount, sessionsCovered should equal totalSessions when known.
- If a partial amount is paid and pricePerSession is known, sessionsCovered = amount / pricePerSession rounded to 2 decimals.
- "left", "remaining", or "balance" means balanceOwed, not amount paid.
- Drop-in/session-only payment with no sessions count should use sessionsCovered 1.
- Mark uncertain extraction with confidence low or medium and add warnings.
- Keep names human-clean, e.g. "Rocky bhai" -> "Rocky Bhai".
- Return dates as YYYY-MM-DD. If a date has month/day but no year, use current year ${currentYear}.`;
}

function extractResponseText(payload: any) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return undefined;
}

function normalizeParsedJson(value: any, rawText: string): ParsedWhatsAppImport {
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
const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

const parsedWhatsAppImportJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rawText", "importType", "confidence", "season", "session", "players", "payments", "attendance", "dropouts", "score", "teams", "goals", "warnings"],
  properties: {
    rawText: { type: "string" },
    importType: { type: "string", enum: ["season_signup", "session_update"] },
    confidence: confidenceSchema,
    season: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["name", "startDate", "endDate", "totalSessions", "pricePerSession"],
          properties: {
            name: nullableString,
            startDate: nullableString,
            endDate: nullableString,
            totalSessions: nullableNumber,
            pricePerSession: nullableNumber
          }
        },
        { type: "null" }
      ]
    },
    session: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["name", "date", "location", "startTime", "endTime", "duration", "totalSessions", "pricePerSession", "fullSeasonCost"],
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
        { type: "null" }
      ]
    },
    players: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "matchedPlayerId", "confidence"],
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
        additionalProperties: false,
        required: ["playerName", "matchedPlayerId", "amount", "sessionsCovered", "paymentMethod", "note", "balanceOwed", "confidence"],
        properties: {
          playerName: { type: "string" },
          matchedPlayerId: nullableString,
          amount: nullableNumber,
          sessionsCovered: nullableNumber,
          paymentMethod: nullableString,
          note: nullableString,
          balanceOwed: nullableNumber,
          confidence: confidenceSchema
        }
      }
    },
    attendance: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["playerName", "matchedPlayerId", "status", "confidence"],
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
        additionalProperties: false,
        required: ["originalPlayerName", "replacementPlayerName", "transferType", "note", "confidence"],
        properties: {
          originalPlayerName: { type: "string" },
          replacementPlayerName: nullableString,
          transferType: {
            type: ["string", "null"],
            enum: [
              "credit_to_original_player",
              "replacement_owes_original_player",
              "replacement_paid_admin",
              "no_credit",
              "manual_adjustment",
              null
            ]
          },
          note: nullableString,
          confidence: confidenceSchema
        }
      }
    },
    score: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["teamAScore", "teamBScore", "confidence"],
          properties: {
            teamAScore: nullableNumber,
            teamBScore: nullableNumber,
            confidence: confidenceSchema
          }
        },
        { type: "null" }
      ]
    },
    teams: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "teamName", "team_name", "label", "captainName", "score", "players", "confidence"],
        properties: {
          name: nullableString,
          teamName: nullableString,
          team_name: nullableString,
          label: nullableString,
          captainName: nullableString,
          score: nullableNumber,
          players: { type: "array", items: { type: "string" } },
          confidence: confidenceSchema
        }
      }
    },
    goals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scorerName", "assistName", "count", "team", "teamName", "note", "confidence"],
        properties: {
          scorerName: { type: "string" },
          assistName: nullableString,
          count: nullableNumber,
          team: { type: ["string", "null"], enum: ["A", "B", null] },
          teamName: nullableString,
          note: nullableString,
          confidence: confidenceSchema
        }
      }
    },
    warnings: { type: "array", items: { type: "string" } }
  }
};
