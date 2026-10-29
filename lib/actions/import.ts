"use server";

import { parseWhatsAppAction as parse, confirmWhatsAppImport as confirm } from "./import-service";

export async function parseWhatsAppAction(previous: unknown, formData: FormData) {
  return parse(previous, formData);
}

export async function confirmWhatsAppImport(previous: unknown, formData: FormData) {
  return confirm(previous, formData);
}
