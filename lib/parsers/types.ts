import type { ParsedWhatsAppImport } from "../types";

export interface WhatsAppParser {
  parse(input: string): Promise<ParsedWhatsAppImport>;
}
