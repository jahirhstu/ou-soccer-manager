"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRightLeft } from "lucide-react";
import { recordClubBalanceTransfer, type ClubTransferState } from "@/lib/actions/club-transfers";
import { money } from "@/lib/utils";

type Season = { id: string; name: string; start_date: string | null; program_id: string | null };

export function ClubBalanceTransferForm({ source, destinations, balance, today, submissionId, unassignedExpenses }: {
  source: Season; destinations: Season[]; balance: number | string; today: string;
  submissionId: string; unassignedExpenses: number;
}) {
  const [state, action] = useActionState<ClubTransferState, FormData>(recordClubBalanceTransfer, null);
  const availableCents = Math.round(Number(balance) * 100);
  const [amount, setAmount] = useState((Math.abs(availableCents) / 100).toFixed(2));
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? "");
  const amountCents = Math.round(Number(amount || 0) * 100);
  const signedCents = availableCents < 0 ? -amountCents : amountCents;
  const destination = destinations.find((season) => season.id === destinationId);
  const disabledReason = unassignedExpenses > 0
    ? "Assign all program expenses to a season before carrying a club balance forward."
    : !source.start_date ? "Set this season's start date before carrying its balance forward."
      : !destinations.length ? "No later season exists in this program."
        : availableCents === 0 ? "This season has no balance remaining to carry forward." : null;

  return <form action={action} className="panel grid max-w-xl gap-4 p-5">
    <h3 className="section-title">Carry club balance forward</h3>
    <p className="text-sm text-slate-600">Available from {source.name}: <strong className="text-ink">{money(Number(balance))}</strong></p>
    {disabledReason ? <p className="text-sm text-amber-800">{disabledReason}</p> : <>
      <input type="hidden" name="source_season_id" value={source.id} />
      <input type="hidden" name="submission_id" value={submissionId} />
      <input type="hidden" name="amount" value={(signedCents / 100).toFixed(2)} />
      <label className="grid gap-1 text-sm font-medium text-slate-700">Destination season
        <select className="input" name="destination_season_id" value={destinationId} onChange={(event) => setDestinationId(event.target.value)} required>
          {destinations.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">{availableCents < 0 ? "Loss to carry" : "Surplus to carry"}
        <input className="input" type="number" min="0.01" max={(Math.abs(availableCents) / 100).toFixed(2)} step="0.01"
          value={amount} onChange={(event) => setAmount(event.target.value)} required />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">Effective date
        <input className="input" type="date" name="transfer_date" max={today} defaultValue={today} required />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">Note (optional)
        <input className="input" name="note" maxLength={300} />
      </label>
      {amountCents > 0 && amountCents <= Math.abs(availableCents) ? <p className="border-t border-slate-200 pt-3 text-sm text-slate-600">
        {source.name} after: <strong className="text-ink">{money((availableCents - signedCents) / 100)}</strong>
        {destination ? `; ${destination.name} receives ${money(signedCents / 100)}` : ""}
      </p> : null}
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="confirmed" value="yes" required />
        <span>I confirm this is a balance carry-forward, not a cash payment or expense.</span>
      </label>
      {state?.error ? <p className="text-sm text-rose-700" role="alert">{state.error}</p> : null}
      <SubmitButton />
    </>}
  </form>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="btn-primary w-fit" disabled={pending}><ArrowRightLeft className="h-4 w-4" /> {pending ? "Recording..." : "Carry forward"}</button>;
}
