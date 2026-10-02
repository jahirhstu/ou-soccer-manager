export const balanceTransferTypes = ["credit_transferred_in", "credit_transferred_out", "debt_transferred_in", "debt_transferred_out"];

export function balanceTransferLabel(type: string): "Credit in" | "Credit out" | "Owing in" | "Owing out" {
  if (type === "credit_transferred_in") return "Credit in";
  if (type === "credit_transferred_out") return "Credit out";
  return type === "debt_transferred_in" ? "Owing in" : "Owing out";
}
