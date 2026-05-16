import type { LedgerType, PlayerBalance } from "./types";

type PaymentLike = { amount: number | null; sessions_covered: number | null };
type AttendanceLike = { status: string };
type LedgerLike = { type: LedgerType; amount: number | null; sessions_count: number | null };

export function calculateRemainingSessions(totalPaidSessions: number, playedSessions: number) {
  return Math.max(totalPaidSessions - playedSessions, 0);
}

export function calculatePlayerBalance(input: {
  payments: PaymentLike[];
  attendance: AttendanceLike[];
  ledgerEntries: LedgerLike[];
  pricePerSession: number;
}): PlayerBalance {
  const totalPaidAmount = sum(input.payments.map((payment) => payment.amount));
  const paidFromPayments = sum(input.payments.map((payment) => payment.sessions_covered));
  const ledgerSessionCredits = sum(
    input.ledgerEntries
      .filter((entry) => ["payment_received", "credit_added", "credit_transferred_in"].includes(entry.type))
      .map((entry) => entry.sessions_count)
  );
  const ledgerSessionDebits = sum(
    input.ledgerEntries
      .filter((entry) => ["session_used", "credit_transferred_out"].includes(entry.type))
      .map((entry) => entry.sessions_count)
  );
  const totalPlayedSessions = input.attendance.filter((row) => ["played", "replacement"].includes(row.status)).length;
  const totalPaidSessions = paidFromPayments + ledgerSessionCredits - ledgerSessionDebits;
  const remainingPaidSessions = calculateRemainingSessions(totalPaidSessions, totalPlayedSessions);
  const sessionsOwed = Math.max(totalPlayedSessions - totalPaidSessions, 0);
  const creditBalance = remainingPaidSessions * input.pricePerSession;
  const refundAmount = sum(
    input.ledgerEntries.filter((entry) => entry.type === "refund_due").map((entry) => entry.amount)
  );

  return {
    totalPaidSessions,
    totalPaidAmount,
    totalPlayedSessions,
    remainingPaidSessions,
    sessionsOwed,
    creditBalance,
    refundAmount,
    owesAmount: sessionsOwed * input.pricePerSession
  };
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + Number(value ?? 0), 0);
}

export function ledgerEntriesForDropoutTransfer(input: {
  transferType: string;
  originalPlayerId: string;
  replacementPlayerId?: string | null;
  pricePerSession: number;
}) {
  const entries: Array<{ player_id: string; related_player_id?: string; type: LedgerType; amount?: number; sessions_count?: number }> = [];
  if (input.transferType === "credit_to_original_player") {
    entries.push({ player_id: input.originalPlayerId, type: "credit_added", amount: input.pricePerSession, sessions_count: 1 });
  }
  if (input.transferType === "replacement_paid_admin" && input.replacementPlayerId) {
    entries.push({ player_id: input.replacementPlayerId, type: "payment_received", amount: input.pricePerSession, sessions_count: 1 });
  }
  if (input.transferType === "replacement_owes_original_player" && input.replacementPlayerId) {
    entries.push({
      player_id: input.originalPlayerId,
      related_player_id: input.replacementPlayerId,
      type: "credit_transferred_out",
      amount: input.pricePerSession,
      sessions_count: 1
    });
    entries.push({
      player_id: input.replacementPlayerId,
      related_player_id: input.originalPlayerId,
      type: "credit_transferred_in",
      amount: input.pricePerSession,
      sessions_count: 1
    });
  }
  return entries;
}
