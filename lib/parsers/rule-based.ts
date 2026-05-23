import type { ParsedWhatsAppImport } from "../types";
import {
  detectDropoutIntent,
  detectPaymentIntent,
  detectReplacementIntent,
  normalizePlayerName,
  parseSessionDate
} from "../utils";
import type { WhatsAppParser } from "./types";

const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;

export class RuleBasedWhatsAppParser implements WhatsAppParser {
  async parse(input: string): Promise<ParsedWhatsAppImport> {
    const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const players = new Map<string, ParsedWhatsAppImport["players"][number]>();
    const payments: ParsedWhatsAppImport["payments"] = [];
    const attendance: ParsedWhatsAppImport["attendance"] = [];
    const dropouts: ParsedWhatsAppImport["dropouts"] = [];
    const teams: ParsedWhatsAppImport["teams"] = [];
    const matches: ParsedWhatsAppImport["matches"] = [];
    const goals: ParsedWhatsAppImport["goals"] = [];
    const warnings: string[] = [];
    const unpairedDropoutIndexes: number[] = [];
    let pendingMatchNumber: number | undefined;
    let score: ParsedWhatsAppImport["score"];
    let date: string | undefined;
    const seasonInfo = extractSeasonInfo(lines);
    const isSeasonSignup = Boolean(seasonInfo.totalSessions || seasonInfo.fullSeasonCost || seasonInfo.endDate);

    for (const line of lines) {
      date ||= parseSessionDate(line) ?? seasonInfo.startDate;

      const rosterRow = parseNumberedRosterRow(line, seasonInfo);
      if (rosterRow) {
        players.set(rosterRow.player.name, rosterRow.player);
        if (!isSeasonSignup) {
          attendance.push({ playerName: rosterRow.player.name, status: rosterRow.attendanceStatus, confidence: "medium" });
          if (rosterRow.attendanceStatus === "dropped") {
            dropouts.push({
              originalPlayerName: rosterRow.player.name,
              transferType: "manual_adjustment",
              note: rosterRow.note,
              confidence: "medium"
            });
            unpairedDropoutIndexes.push(dropouts.length - 1);
          }
          if (rosterRow.attendanceStatus === "replacement" && unpairedDropoutIndexes.length) {
            const dropoutIndex = unpairedDropoutIndexes.shift();
            if (dropoutIndex != null && dropouts[dropoutIndex]) {
              dropouts[dropoutIndex] = {
                ...dropouts[dropoutIndex],
                replacementPlayerName: rosterRow.player.name
              };
            }
          }
        }
        if (rosterRow.payment) payments.push(rosterRow.payment);
        if (rosterRow.warning) warnings.push(rosterRow.warning);
        continue;
      }

      if (isGenericSeasonInfoLine(line)) continue;

      const matchHeader = line.match(/^game\s*(\d{1,2})\s*:?\s*$/i);
      if (matchHeader) {
        pendingMatchNumber = Number(matchHeader[1]);
        continue;
      }
      const miniGame = parseMiniGameLine(line, pendingMatchNumber);
      if (miniGame) {
        matches.push(miniGame);
        pendingMatchNumber = undefined;
        continue;
      }

      const lineNames = extractNames(line);
      const teamRow = parseTeamLine(line);
      if (teamRow) {
        teams.push(teamRow);
        teamRow.players.forEach((name) => players.set(name, { name, confidence: "medium" }));
        continue;
      }
      if (isLikelyChatEventLine(line)) {
        lineNames.forEach((name) => players.set(name, { name, confidence: "medium" }));
      }

      const scoreMatch = line.match(/\b(?:score\s*)?(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\b/i);
      if (scoreMatch) {
        score = { teamAScore: Number(scoreMatch[1]), teamBScore: Number(scoreMatch[2]), confidence: /score/i.test(line) ? "high" : "medium" };
      }

      if (detectPaymentIntent(line)) {
        const playerName = lineNames[0];
        const amount = parsePlayerLinePaymentAmount(line);
        const sessionsCovered = parseSessionsCovered(line) ?? (isSessionOnlyPayment(line) || detectSentWithoutAmount(line, amount) ? 1 : undefined);
        if (playerName) {
          payments.push({
            playerName,
            amount,
            sessionsCovered,
            amountSource: amount ? "player_line" : detectSentWithoutAmount(line, amount) ? "inferred_session_price" : undefined,
            paymentMethod: detectMethod(line),
            note: line,
            confidence: amount ? "high" : "medium"
          });
        } else {
          warnings.push(`Payment-like line has no clear player: "${line}"`);
        }
      }

      if (detectDropoutIntent(line)) {
        const originalPlayerName = lineNames[0];
        if (originalPlayerName) {
          dropouts.push({
            originalPlayerName,
            replacementPlayerName: detectReplacementIntent(line) ? lineNames[1] : undefined,
            transferType: "manual_adjustment",
            note: line,
            confidence: "medium"
          });
          attendance.push({ playerName: originalPlayerName, status: "dropped", confidence: "high" });
        }
      }

      if (detectReplacementIntent(line)) {
        const replacement = line.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:takes spot|taking spot|replacing|in for|sub for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        const replacementPlayerName = normalizePlayerName(replacement?.[1] ?? lineNames[0] ?? "");
        const originalPlayerName = normalizePlayerName(replacement?.[2] ?? lineNames[1] ?? "");
        if (replacementPlayerName) {
          attendance.push({ playerName: replacementPlayerName, status: "replacement", confidence: replacement ? "high" : "medium" });
        }
        if (originalPlayerName) {
          dropouts.push({
            originalPlayerName,
            replacementPlayerName,
            transferType: "manual_adjustment",
            note: line,
            confidence: replacement ? "high" : "medium"
          });
        }
      }

      const goalWithCount = line.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(\d+)\s+goals?/i);
      const goalLine = line.match(/goal:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:.*assist\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?))?/i);
      const assisted = line.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+goal\s+assist\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      if (goalWithCount) {
        goals.push({ scorerName: normalizePlayerName(goalWithCount[1]), count: Number(goalWithCount[2]), note: line, confidence: "high" });
      } else if (goalLine) {
        goals.push({
          scorerName: normalizePlayerName(goalLine[1]),
          assistName: goalLine[2] ? normalizePlayerName(goalLine[2]) : undefined,
          count: 1,
          note: line,
          confidence: "high"
        });
      } else if (assisted) {
        goals.push({
          scorerName: normalizePlayerName(assisted[1]),
          assistName: normalizePlayerName(assisted[2]),
          count: 1,
          note: line,
          confidence: "high"
        });
      }

      if (/\b(in|confirmed|playing|available)\b/i.test(line) && lineNames[0] && !detectPaymentIntent(line) && isLikelyChatEventLine(line)) {
        attendance.push({ playerName: lineNames[0], status: "confirmed", confidence: "medium" });
      }
    }

    if (!date) warnings.push("No clear session date detected.");
    if (!players.size) warnings.push("No player names detected.");
    if (seasonInfo.endDate) warnings.push(`Detected season end date: ${seasonInfo.endDate}.`);

    return {
      rawText: input,
      importType: isSeasonSignup ? "season_signup" : "session_update",
      confidence: warnings.length ? "medium" : "high",
      season: buildSeasonDraft(seasonInfo),
      session: buildSessionDraft(date, seasonInfo),
      players: Array.from(players.values()),
      payments,
      attendance: dedupeAttendance(attendance),
      dropouts,
      score,
      teams,
      matches: dedupeMatches(matches),
      goals,
      warnings
    };
  }
}

function parseMiniGameLine(line: string, pendingMatchNumber?: number): ParsedWhatsAppImport["matches"][number] | null {
  const oneLine = line.match(/^game\s*(\d{1,2})\s*:\s*(.+)$/i);
  const matchNumber = oneLine ? Number(oneLine[1]) : pendingMatchNumber;
  const body = (oneLine ? oneLine[2] : line).trim();
  if (!matchNumber) return null;
  const scoreMatch = body.match(/^(.+?)\s+(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s+(.+)$/i);
  if (!scoreMatch) return null;
  return {
    matchNumber,
    teamAName: normalizeTeamName(scoreMatch[1]),
    teamAScore: Number(scoreMatch[2]),
    teamBScore: Number(scoreMatch[3]),
    teamBName: normalizeTeamName(scoreMatch[4]),
    confidence: "high"
  };
}

function normalizeTeamName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseTeamLine(line: string): ParsedWhatsAppImport["teams"][number] | null {
  const match = line.match(/^(team\s*[A-C1-3]|team\s+\w+|[A-C])\s*(?:\((\d+)\)|:\s*|\-\s*)(.+)$/i);
  if (!match) return null;
  const name = normalizePlayerName(match[1]);
  const score = match[2] ? Number(match[2]) : undefined;
  const captainName = extractCaptainName(match[3]);
  const players = extractNames(match[3]).filter((playerName) => !["Vs", "Captain"].includes(playerName));
  if (!players.length) return null;
  return { name, label: name, captainName, score, players, confidence: "medium" };
}

function extractCaptainName(value: string) {
  const match = value.match(/\b(?:captain|cap|c)\s*[:=-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  return match ? normalizePlayerName(match[1]) : undefined;
}

type SeasonInfo = {
  name?: string;
  sessionName?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  totalSessions?: number;
  pricePerSession?: number;
  fullSeasonCost?: number;
};

function extractSeasonInfo(lines: string[]): SeasonInfo {
  const info: SeasonInfo = {};
  for (const [index, line] of lines.entries()) {
    if (index === 0 && /\bseason\b/i.test(line) && !/:/.test(line)) {
      info.name = line.trim();
    }

    const seasonName = line.match(/season\s*(?:name)?:\s*(.+)$/i);
    if (seasonName) info.name = seasonName[1].trim();

    const sessionName = line.match(/(?:session|game|match)\s*name:\s*(.+)$/i);
    if (sessionName) info.sessionName = sessionName[1].trim();

    const dates = line.match(/season dates?:\s*([A-Za-z]+\s+\d{1,2})\s+to\s+([A-Za-z]+\s+\d{1,2})/i);
    if (dates) {
      info.startDate = parseMonthDay(dates[1]);
      info.endDate = parseMonthDay(dates[2]);
    }

    const time = line.match(/time:\s*([0-9: ]+\s*[AP]M)\s*[–-]\s*([0-9: ]+\s*[AP]M)/i);
    if (time) {
      info.startTime = normalizeTime(time[1]);
      info.endTime = normalizeTime(time[2]);
    }

    const location = line.match(/(?:location|play\s*ground|playground|ground|field|venue):\s*(.+)$/i);
    if (location) info.location = location[1].trim();

    const duration = line.match(/duration:\s*(.+)$/i);
    if (duration) info.duration = duration[1].trim();

    const total = line.match(/total sessions:\s*(\d+)/i);
    if (total) info.totalSessions = Number(total[1]);

    const cost = line.match(/cost per session:\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
    if (cost) info.pricePerSession = Number(cost[1]);

    const full = line.match(/full season cost:\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
    if (full) info.fullSeasonCost = Number(full[1]);
  }
  return info;
}

function parseNumberedRosterRow(line: string, seasonInfo: SeasonInfo) {
  const cleaned = line.replace(/[\u2007\u2060\u034f]/g, " ").replace(/\u2060/g, " ").trim();
  const match = cleaned.match(/^\s*\d{1,3}[.)]?\s*[^\p{L}\p{N}$]*(.+)$/u);
  if (!match) return null;

  const body = match[1].replace(/^[^\p{L}\p{N}$]+/u, "").trim();
  const nameMatch = body.match(/^(.+?)(?:\s*[-–]\s*|\s*[\[(]|$)/u);
  const rawName = nameMatch?.[1]?.replace(/[^\p{L}\p{M}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!rawName || /\b(paid|left|cad|available|after|session)\b/i.test(rawName)) return null;

  const name = normalizePlayerName(rawName);
  const amount = parsePaidAmount(body);
  const balanceLeft = parseBalanceLeft(body);
  const sentWithoutAmount = !amount && /\bsent\b/i.test(body);
  const sessionsCovered =
    amount && seasonInfo.fullSeasonCost && seasonInfo.totalSessions && Math.abs(amount - seasonInfo.fullSeasonCost) < 0.01
      ? seasonInfo.totalSessions
      : amount && seasonInfo.pricePerSession
        ? Number((amount / seasonInfo.pricePerSession).toFixed(2))
        : sentWithoutAmount
          ? 1
          : undefined;
  const note = body.replace(rawName, "").trim();

  return {
    player: { name, confidence: "high" as const },
    attendanceStatus: rosterAttendanceStatus(body),
    note,
    payment: amount || sentWithoutAmount
      ? {
          playerName: name,
          amount,
          sessionsCovered,
          amountSource: amount ? "player_line" as const : "inferred_session_price" as const,
          paymentMethod: "e-transfer",
          note: note || body,
          balanceOwed: balanceLeft,
          confidence: amount ? "high" as const : "medium" as const
        }
      : undefined,
    warning: balanceLeft ? `${name} has ${balanceLeft} CAD marked as left/remaining balance.` : undefined
  };
}

function rosterAttendanceStatus(body: string): ParsedWhatsAppImport["attendance"][number]["status"] {
  if (/\b(?:dropped|drop|out|balance will remain)\b/i.test(body)) return "dropped";
  if (/\b(?:replaced|replacement)\b/i.test(body)) return "replacement";
  if (/\bpending\b/i.test(body)) return "waitlisted";
  return "confirmed";
}

function buildSeasonDraft(seasonInfo: SeasonInfo): ParsedWhatsAppImport["season"] {
  if (!seasonInfo.name && !seasonInfo.startDate && !seasonInfo.endDate && !seasonInfo.totalSessions && !seasonInfo.pricePerSession) return undefined;
  return {
    name: seasonInfo.name,
    startDate: seasonInfo.startDate,
    endDate: seasonInfo.endDate,
    totalSessions: seasonInfo.totalSessions,
    pricePerSession: seasonInfo.pricePerSession
  };
}

function buildSessionDraft(date: string | undefined, seasonInfo: SeasonInfo): ParsedWhatsAppImport["session"] {
  if (!date && !seasonInfo.sessionName && !seasonInfo.location && !seasonInfo.totalSessions && !seasonInfo.pricePerSession && !seasonInfo.fullSeasonCost) return undefined;
  return {
    name: seasonInfo.sessionName,
    date,
    location: seasonInfo.location,
    startTime: seasonInfo.startTime,
    endTime: seasonInfo.endTime,
    duration: seasonInfo.duration,
    totalSessions: seasonInfo.totalSessions,
    pricePerSession: seasonInfo.pricePerSession,
    fullSeasonCost: seasonInfo.fullSeasonCost
  };
}

function parsePaidAmount(line: string) {
  const match = line.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:cad\s*)?(?:paid|sent|payment|e-?transfer|cash|bank)\b|\b(?:paid|sent|payment|e-?transfer|cash|bank)\b\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

function parsePlayerLinePaymentAmount(line: string) {
  if (isGeneralPaymentContextLine(line)) return undefined;
  const match = line.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:cad\s*)?(?:paid|sent|payment|e-?transfer|cash|bank)\b|\b(?:paid|sent|payment|e-?transfer|cash|bank)\b\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

function isGeneralPaymentContextLine(line: string) {
  return /\b(?:drop-?ins?|cost per session|full season|remaining balance|please pay|please e-?transfer|interac|for players who already paid)\b/i.test(line);
}

function parseBalanceLeft(line: string) {
  const match = line.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:cad\s*)?(?:left|remaining|balance)/i);
  return match ? Number(match[1]) : undefined;
}

function parseMonthDay(value: string) {
  return parseSessionDate(value);
}

function normalizeTime(value: string) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!match) return value.trim();
  let hours = Number(match[1]);
  const minutes = match[2] ?? "00";
  const period = match[3].toUpperCase();
  if (period === "PM" && hours < 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

function isLikelyChatEventLine(line: string) {
  return /\b(paid|sent|transfer|e-transfer|cash|bank|out|drop|cannot come|not coming|takes spot|replacing|in for|goal|score|confirmed|playing|available)\b/i.test(line);
}

function isGenericSeasonInfoLine(line: string) {
  return /^(season dates?|day|time|location|total sessions|cost per session|full season cost|remaining balance|interac|rules and priority|for players who already paid)\b/i.test(line);
}

function extractNames(line: string) {
  return Array.from(line.matchAll(namePattern))
    .map((match) => normalizePlayerName(match[0]))
    .filter((name) => !["Goal", "Score", "Paid", "Sent", "Transfer", "Cash", "Bank", "Season Dates", "Total Sessions", "Full Season", "Ottawa Soccer", "Cost", "Location"].includes(name));
}

function parseSessionsCovered(line: string) {
  const match = line.match(/(\d+(?:\.\d+)?)\s*(?:sessions?|games?)/i);
  return match ? Number(match[1]) : undefined;
}

function isSessionOnlyPayment(line: string) {
  return /\b(drop-?in|this session|this game|today|tonight|for today|for tonight)\b/i.test(line);
}

function detectSentWithoutAmount(line: string, amount: number | undefined) {
  return amount == null && /\bsent\b/i.test(line);
}

function detectMethod(line: string) {
  if (/e-?transfer/i.test(line)) return "e-transfer";
  if (/cash/i.test(line)) return "cash";
  if (/bank/i.test(line)) return "bank transfer";
  return "e-transfer";
}

function dedupeAttendance(rows: ParsedWhatsAppImport["attendance"]) {
  const byPlayer = new Map<string, ParsedWhatsAppImport["attendance"][number]>();
  rows.forEach((row) => byPlayer.set(`${row.playerName}:${row.status}`, row));
  return Array.from(byPlayer.values());
}

function dedupeMatches(rows: ParsedWhatsAppImport["matches"]) {
  const byNumber = new Map<number, ParsedWhatsAppImport["matches"][number]>();
  rows.forEach((row) => byNumber.set(row.matchNumber, row));
  return Array.from(byNumber.values()).sort((left, right) => left.matchNumber - right.matchNumber);
}
