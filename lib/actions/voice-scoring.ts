"use server";

import { geminiCandidateModels, generateGeminiJson, generateOpenAIJson } from "@/lib/llm/json";

type VoiceScoringGoal = {
  assistName?: string;
  confidence?: "low" | "medium" | "high";
  goalCount?: number;
  goalType?: "goal" | "own_goal";
  matchNumber: number;
  scorerName: string;
};

type VoiceScoringParseResult = {
  goals?: VoiceScoringGoal[];
  parser?: {
    engine: "llm" | "rule_based";
    provider: "openai" | "gemini" | "rule_based";
    model?: string;
    fallbackUsed?: boolean;
  };
  rawText?: string;
  warnings?: string[];
  error?: string;
};

type VoiceTranscriptionResult = {
  error?: string;
  model?: string;
  provider?: "openai";
  transcript?: string;
};

type VoiceScoringContext = {
  matches: Array<{
    matchNumber: number;
    teams: Array<{
      name: string;
      players: string[];
    }>;
  }>;
};

export async function parseVoiceScoringCommand(formData: FormData): Promise<VoiceScoringParseResult> {
  const rawText = String(formData.get("commandText") ?? "").trim();
  if (!rawText) return { error: "Enter or record a scoring command first." };

  let context: VoiceScoringContext;
  try {
    context = JSON.parse(String(formData.get("contextJson") ?? "{}")) as VoiceScoringContext;
  } catch {
    return { error: "Scoring context is invalid. Refresh and try again." };
  }
  if (!Array.isArray(context.matches) || !context.matches.length) return { error: "No games are available to score." };

  const provider = process.env.WHATSAPP_PARSER_PROVIDER;
  if (provider === "openai" && process.env.OPENAI_API_KEY) return parseWithOpenAI(rawText, context);
  if (provider === "gemini" && process.env.GEMINI_API_KEY) return parseWithGemini(rawText, context);
  if (process.env.GEMINI_API_KEY) return parseWithGemini(rawText, context);
  if (process.env.OPENAI_API_KEY) return parseWithOpenAI(rawText, context);

  return {
    ...parseVoiceScoringRuleBased(rawText),
    parser: { engine: "rule_based", provider: "rule_based", fallbackUsed: true },
    rawText,
    warnings: ["LLM parser key is missing. Used simple voice scoring parser."]
  };
}

export async function transcribeVoiceScoringAudio(formData: FormData): Promise<VoiceTranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY is missing. Audio transcription requires OpenAI for now." };

  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size <= 0) return { error: "No audio recording was received." };

  const contextText = String(formData.get("contextText") ?? "").trim();
  const models = openAITranscriptionModels();
  const errors: string[] = [];
  for (const model of models) {
    const result = await tryOpenAITranscription({ apiKey, audio, contextText, model });
    if (result.transcript) return result;
    if (result.error) errors.push(result.error);
  }

  return { error: errors.join(" | ") || "Could not transcribe audio." };
}

async function tryOpenAITranscription({
  apiKey,
  audio,
  contextText,
  model
}: {
  apiKey: string;
  audio: File;
  contextText: string;
  model: string;
}): Promise<VoiceTranscriptionResult> {
  try {
    const body = new FormData();
    body.set("file", audio, audio.name || "voice-scoring.webm");
    body.set("model", model);
    body.set("response_format", "json");
    if (contextText) body.set("prompt", contextText);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body
    });
    if (!response.ok) return { error: `${model}: ${response.status} ${await response.text()}` };

    const payload = await response.json();
    const transcript = String(payload.text ?? "").trim();
    if (!transcript) return { error: `${model}: transcription returned no text.` };
    return { model, provider: "openai", transcript };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "OpenAI transcription failed." };
  }
}

function openAITranscriptionModels() {
  const configured = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim();
  return Array.from(new Set([configured, "gpt-4o-mini-transcribe", "whisper-1"].filter(Boolean) as string[]));
}

async function parseWithGemini(rawText: string, context: VoiceScoringContext): Promise<VoiceScoringParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return parseVoiceScoringCommandFallback(rawText, "Gemini key is missing.");
  try {
    const result = await generateGeminiJson({
      apiKey,
      models: geminiCandidateModels(process.env.GEMINI_WHATSAPP_PARSER_MODEL),
      prompt: `${voiceScoringInstructions(context)}\n\nScoring command:\n${rawText}`,
      schema: geminiVoiceScoringSchema
    });
    return normalizeVoiceScoringJson(result.json, rawText, { engine: "llm", provider: "gemini", model: result.model });
  } catch (error) {
    return parseVoiceScoringCommandFallback(rawText, error instanceof Error ? error.message : "Gemini scoring parser failed.");
  }
}

async function parseWithOpenAI(rawText: string, context: VoiceScoringContext): Promise<VoiceScoringParseResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return parseVoiceScoringCommandFallback(rawText, "OpenAI key is missing.");
  const model = process.env.OPENAI_WHATSAPP_PARSER_MODEL ?? "gpt-4.1-mini";
  try {
    const result = await generateOpenAIJson({
      apiKey,
      input: rawText,
      model,
      schema: openAIVoiceScoringSchema,
      schemaName: "voice_scoring_command",
      system: voiceScoringInstructions(context)
    });
    return normalizeVoiceScoringJson(result.json, rawText, { engine: "llm", provider: "openai", model: result.model });
  } catch (error) {
    return parseVoiceScoringCommandFallback(rawText, error instanceof Error ? error.message : "OpenAI scoring parser failed.");
  }
}

function parseVoiceScoringCommandFallback(rawText: string, warning: string): VoiceScoringParseResult {
  return {
    ...parseVoiceScoringRuleBased(rawText),
    parser: { engine: "rule_based", provider: "rule_based", fallbackUsed: true },
    rawText,
    warnings: [warning, "Used simple voice scoring parser."]
  };
}

function parseVoiceScoringRuleBased(rawText: string): Pick<VoiceScoringParseResult, "goals"> {
  const goals: VoiceScoringGoal[] = [];
  const segments = rawText.split(/[.;\n]+/).map((segment) => segment.trim()).filter(Boolean);
  let currentMatchNumber: number | null = null;
  for (const segment of segments) {
    const matchNumber: number | null = parseMatchNumber(segment) ?? currentMatchNumber;
    if (matchNumber) currentMatchNumber = matchNumber;
    const scorerName = extractNameAfter(segment, ["goal by", "scored by", "score by", "scorer", "by"]);
    if (!matchNumber || !scorerName) continue;
    const assistName = extractNameAfter(segment, ["assist by", "assisted by", "assist"]);
    goals.push({
      assistName,
      confidence: "medium",
      goalCount: 1,
      goalType: normalizeText(segment).includes("own goal") ? "own_goal" : "goal",
      matchNumber,
      scorerName
    });
  }
  return { goals };
}

function parseMatchNumber(text: string): number | null {
  const normalized = normalizeText(text);
  const numeric = normalized.match(/\b(?:game|match|g)\s*(\d+)\b/);
  if (numeric) return Number(numeric[1]);
  const words = new Map([
    ["one", 1],
    ["two", 2],
    ["three", 3],
    ["four", 4],
    ["five", 5],
    ["six", 6],
    ["seven", 7],
    ["eight", 8],
    ["nine", 9],
    ["ten", 10]
  ]);
  for (const [word, value] of words) {
    if (normalized.includes(`game ${word}`) || normalized.includes(`match ${word}`)) return value;
  }
  return null;
}

function extractNameAfter(text: string, markers: string[]) {
  const normalized = normalizeText(text);
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index < 0) continue;
    let value = text.slice(index + marker.length).trim();
    value = value.replace(/\b(?:assist|assisted)\b.*$/i, "").replace(/\b(?:game|match)\s+\w+.*$/i, "").trim();
    return value || undefined;
  }
  return undefined;
}

function normalizeVoiceScoringJson(value: any, rawText: string, parser: NonNullable<VoiceScoringParseResult["parser"]>): VoiceScoringParseResult {
  const goals = Array.isArray(value?.goals) ? value.goals : [];
  return {
    goals: goals
      .map((goal: any) => ({
        assistName: cleanName(goal.assistName),
        confidence: ["low", "medium", "high"].includes(goal.confidence) ? goal.confidence : "medium",
        goalCount: Math.max(1, Number(goal.goalCount ?? 1) || 1),
        goalType: goal.goalType === "own_goal" ? "own_goal" : "goal",
        matchNumber: Number(goal.matchNumber),
        scorerName: cleanName(goal.scorerName)
      }))
      .filter((goal: VoiceScoringGoal) => Number.isFinite(goal.matchNumber) && goal.matchNumber > 0 && goal.scorerName),
    parser,
    rawText,
    warnings: Array.isArray(value?.warnings) ? value.warnings.map(String).filter(Boolean) : []
  };
}

function voiceScoringInstructions(context: VoiceScoringContext) {
  return `Parse soccer scoring voice/text commands into JSON.

Return only JSON matching this shape:
{
  "goals": [
    {
      "matchNumber": 1,
      "scorerName": "Player Name",
      "assistName": "Player Name",
      "goalType": "goal",
      "goalCount": 1,
      "confidence": "high"
    }
  ],
  "warnings": []
}

Rules:
- Extract one row per goal.
- Use matchNumber from words like "game five", "G5", or "match 5".
- If the command starts with a game number, apply it to following goals until another game number is spoken.
- goalType is "own_goal" only when own goal is clearly spoken; otherwise "goal".
- assistName is optional.
- goalCount defaults to 1.
- Do not invent names, games, or assists.
- Prefer exact player names from the available context below.
- If uncertain, still return the best draft and add a warning.

Available games and players:
${JSON.stringify(context, null, 2)}`;
}

function cleanName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const geminiVoiceScoringSchema = {
  type: "OBJECT",
  properties: {
    goals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          matchNumber: { type: "NUMBER" },
          scorerName: { type: "STRING" },
          assistName: { type: "STRING" },
          goalType: { type: "STRING", enum: ["goal", "own_goal"] },
          goalCount: { type: "NUMBER" },
          confidence: { type: "STRING", enum: ["low", "medium", "high"] }
        },
        required: ["matchNumber", "scorerName"]
      }
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } }
  },
  required: ["goals"]
};

const openAIVoiceScoringSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          matchNumber: { type: "number" },
          scorerName: { type: "string" },
          assistName: { type: ["string", "null"] },
          goalType: { type: "string", enum: ["goal", "own_goal"] },
          goalCount: { type: "number" },
          confidence: { type: "string", enum: ["low", "medium", "high"] }
        },
        required: ["matchNumber", "scorerName", "assistName", "goalType", "goalCount", "confidence"]
      }
    },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["goals", "warnings"]
};
