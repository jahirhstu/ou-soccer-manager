import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value ?? 0);
}

export function normalizePlayerName(name: string) {
  return name
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function parseCurrencyAmount(input: string) {
  const match = input.match(/(?:\$|cad\s*)?(\d+(?:\.\d{1,2})?)/i);
  return match ? Number(match[1]) : undefined;
}

export function parseSessionDate(input: string) {
  const iso = input.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const numeric = input.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](20\d{2}))?\b/);
  if (numeric) {
    const year = numeric[3] ?? new Date().getFullYear().toString();
    return `${year}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  }
  return undefined;
}

export function detectPaymentIntent(input: string) {
  return /\b(paid|sent|transfer|e-transfer|etransfer|cash|bank)\b/i.test(input);
}

export function detectDropoutIntent(input: string) {
  return /\b(out|drop|dropped|cannot come|can't come|not coming)\b/i.test(input);
}

export function detectReplacementIntent(input: string) {
  return /\b(takes spot|taking spot|replacing|in for|sub for)\b/i.test(input);
}
