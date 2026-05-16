import { GeminiWhatsAppParser } from "./gemini";
import { OllamaWhatsAppParser } from "./ollama";
import { OpenAIWhatsAppParser } from "./openai";
import { RuleBasedWhatsAppParser } from "./rule-based";

export const whatsappParser = createWhatsAppParser();
export type { WhatsAppParser } from "./types";

function createWhatsAppParser() {
  if (process.env.WHATSAPP_PARSER_PROVIDER === "openai") return new OpenAIWhatsAppParser();
  if (process.env.WHATSAPP_PARSER_PROVIDER === "gemini") return new GeminiWhatsAppParser();
  if (process.env.WHATSAPP_PARSER_PROVIDER === "ollama") return new OllamaWhatsAppParser();
  return new RuleBasedWhatsAppParser();
}
