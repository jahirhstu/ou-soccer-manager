import type { ParsedWhatsAppImport } from "../types";
import { extractJsonObject, normalizeParsedJson, parserInstructions } from "./llm-shared";
import { RuleBasedWhatsAppParser } from "./rule-based";
import type { WhatsAppParser } from "./types";

export class OllamaWhatsAppParser implements WhatsAppParser {
  private fallback = new RuleBasedWhatsAppParser();

  async parse(input: string): Promise<ParsedWhatsAppImport> {
    const model = process.env.OLLAMA_WHATSAPP_PARSER_MODEL ?? "qwen2.5:7b";

    try {
      const { payload, baseUrl } = await generateWithBaseUrlFallback({ input, model });
      if (!payload.response) throw new Error("Ollama returned no response text.");

      const parsed = normalizeParsedJson(JSON.parse(extractJsonObject(payload.response)), input);
      parsed.parser = { engine: "llm", provider: "ollama", model };
      parsed.warnings.unshift(`Parsed with Ollama model ${model} at ${baseUrl}.`);
      return parsed;
    } catch (error) {
      const parsed = await this.fallback.parse(input);
      parsed.parser = { engine: "rule_based", provider: "ollama", model, fallbackUsed: true };
      parsed.warnings.unshift(`Ollama parser failed. Used rule-based parser. ${error instanceof Error ? error.message : ""}`.trim());
      parsed.confidence = "low";
      return parsed;
    }
  }
}

async function generateWithBaseUrlFallback({ input, model }: { input: string; model: string }) {
  const errors: string[] = [];
  for (const baseUrl of getCandidateBaseUrls()) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: `${parserInstructions()}\n\nWhatsApp message:\n${input}`,
          stream: false,
          format: "json",
          options: {
            temperature: 0.1
          }
        })
      });

      if (response.ok) {
        return { payload: await response.json(), baseUrl };
      }

      errors.push(`${baseUrl}: ${response.status} ${await response.text()}`);
    } catch (error) {
      errors.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

function getCandidateBaseUrls() {
  return Array.from(
    new Set([
      process.env.OLLAMA_BASE_URL,
      "http://127.0.0.1:11434",
      "http://localhost:11434"
    ].filter(Boolean) as string[])
  );
}
