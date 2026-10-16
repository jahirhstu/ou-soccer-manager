export const balanceTransferTypes = ["credit_transferred_in", "credit_transferred_out", "debt_transferred_in", "debt_transferred_out"];

export function balanceTransferLabel(type: string, relatedPlayerId?: string | null, relatedName?: string | null): string {
  if (relatedPlayerId && type === "credit_transferred_in") return `Credit received from ${relatedName || relatedPlayerId}`;
  if (relatedPlayerId && type === "credit_transferred_out") return `Credit sent to ${relatedName || relatedPlayerId}`;
  if (type === "credit_transferred_in") return "Credit in";
  if (type === "credit_transferred_out") return "Credit out";
  return type === "debt_transferred_in" ? "Owing in" : "Owing out";
}
