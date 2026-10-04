import type { ParsedWhatsAppImport } from "./types";

type ImportedPayment = {
  amount?: number | string | null;
  amountSource?: "player_line" | "inferred_session_price" | "general_context" | null;
  note?: string | null;
};

export function normalizeImportedPaymentAmountSource(
  payment: ImportedPayment
): ParsedWhatsAppImport["payments"][number]["amountSource"] {
  const amount = Number(payment.amount ?? 0);
  const note = String(payment.note ?? "");
  const positiveAmount = Number.isFinite(amount) && amount > 0;
  const generalContext = /\b(?:drop-?ins?|cost per session|full season cost|remaining balance|please pay|please e-?transfer|interac|for players who already paid)\b/i.test(note);

  // Parsers may keep only "Paid" in the note after extracting the player-line amount.
  if (positiveAmount && payment.amountSource === "player_line" && !generalContext) return "player_line";
  if (positiveAmount && !generalContext && playerLineHasPaymentAmount(note)) return "player_line";
  if (/\bsent\b/i.test(note)) return "inferred_session_price";
  if (payment.amountSource === "inferred_session_price") return "inferred_session_price";
  if (positiveAmount) return "general_context";
  return payment.amountSource ?? undefined;
}

function playerLineHasPaymentAmount(note: string) {
  return /\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:cad\s*)?(?:paid|sent|payment|e-?transfer|cash|bank)\b|\b(?:paid|sent|payment|e-?transfer|cash|bank)\b\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i.test(note);
}
