export type CreditBalance = { playerId: string; seasonId: string; credit: string; owes: string };

export function amountInCents(value: string): bigint | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function centsAmount(value: bigint): string {
  const absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

export function creditTransferPreview(balances: CreditBalance[], seasonId: string, fundingId: string, recipientId: string, amount: string) {
  const balance = (id: string) => balances.find(row => row.playerId === id && row.seasonId === seasonId);
  const funding = balance(fundingId), recipient = balance(recipientId);
  const available = amountInCents(funding?.credit ?? "0") ?? BigInt(0);
  const source = available - (amountInCents(funding?.owes ?? "0") ?? BigInt(0));
  const target = (amountInCents(recipient?.credit ?? "0") ?? BigInt(0)) - (amountInCents(recipient?.owes ?? "0") ?? BigInt(0));
  const cents = amountInCents(amount);
  return { available, source, target, cents,
    valid: Boolean(seasonId && fundingId && recipientId && fundingId !== recipientId && cents !== null && cents > BigInt(0) && cents <= available && cents <= BigInt(9999999999)),
    sourceAfter: source - (cents ?? BigInt(0)), targetAfter: target + (cents ?? BigInt(0)) };
}
