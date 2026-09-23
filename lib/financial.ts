type CreditActivity = {
  payments?: Array<number | string | null | undefined>;
  charges?: Array<number | string | null | undefined>;
  adjustments?: Array<{
    type: "credit_added" | "credit_transferred_in" | "credit_transferred_out" | "refund_paid" | "manual_adjustment";
    amount: number | string | null | undefined;
  }>;
};

export function availableCreditCents(activity: CreditActivity): number {
  const payments = sumCents(activity.payments ?? []);
  const charges = sumCents(activity.charges ?? []);
  const adjustments = (activity.adjustments ?? []).reduce((total, entry) => {
    const amount = moneyToCents(entry.amount);
    if (entry.type === "credit_added" || entry.type === "credit_transferred_in") return total + amount;
    if (entry.type === "credit_transferred_out" || entry.type === "refund_paid") return total - amount;
    return total + amount;
  }, 0);
  return Math.max(payments - charges + adjustments, 0);
}

export function totalPlayerCreditRemainingCents(activities: CreditActivity[]): number {
  return activities.reduce((total, activity) => total + availableCreditCents(activity), 0);
}

function sumCents(values: Array<number | string | null | undefined>): number {
  return values.reduce<number>((total, value) => total + moneyToCents(value), 0);
}

function moneyToCents(value: number | string | null | undefined): number {
  const normalized = String(value ?? 0).trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`Invalid money value: ${normalized}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}
