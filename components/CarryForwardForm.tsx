"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { carryForwardPlayerBalance, type TransferActionState } from "@/lib/actions/transfers";
import { money } from "@/lib/utils";

type Source = { playerId: string; playerName: string; seasonId: string; seasonName: string; programId: string; credit: string; owes: string };
type Season = { id: string; name: string; program_id: string };
type Balance = { playerId: string; seasonId: string; credit: string; owes: string };

export function CarryForwardForm({ options, seasons, balances, initialPlayerId, initialSeasonId, submissionId, today }: {
  options: Source[]; seasons: Season[]; balances: Balance[];
  initialPlayerId?: string; initialSeasonId?: string; submissionId: string; today: string;
}) {
  const initial = options.find((item) => item.playerId === initialPlayerId && item.seasonId === initialSeasonId) ?? options[0];
  const [selection, setSelection] = useState(initial ? `${initial.playerId}:${initial.seasonId}` : "");
  const [destinationId, setDestinationId] = useState("");
  const [amount, setAmount] = useState(initial ? Number(initial.credit) > 0 ? initial.credit : initial.owes : "");
  const [state, action] = useActionState<TransferActionState, FormData>(carryForwardPlayerBalance, null);
  const selected = options.find((item) => `${item.playerId}:${item.seasonId}` === selection);
  const destinations = useMemo(() => seasons.filter((season) => selected && season.program_id === selected.programId && season.id !== selected.seasonId), [seasons, selected]);
  const destination = destinations.find((season) => season.id === destinationId) ?? destinations[0];
  const target = balances.find((row) => row.playerId === selected?.playerId && row.seasonId === destination?.id);
  const transferKind = Number(selected?.credit ?? 0) > 0 ? "credit" : "debt";
  const availableAmount = transferKind === "credit" ? selected?.credit : selected?.owes;
  const sourceCents = Math.round((Number(selected?.credit ?? 0) - Number(selected?.owes ?? 0)) * 100);
  const availableCents = Math.abs(sourceCents);
  const amountCents = Math.round(Number(amount || 0) * 100);
  const targetCents = Math.round((Number(target?.credit ?? 0) - Number(target?.owes ?? 0)) * 100);

  return <form action={action} className="panel grid max-w-xl gap-4 p-5">
    <h1 className="section-title">Carry forward balance</h1>
    {options.length ? <>
      <label className="grid gap-1 text-sm font-medium text-slate-700">Player and source season
        <select className="input" value={selection} onChange={(event) => {
          const next = options.find((item) => `${item.playerId}:${item.seasonId}` === event.target.value);
          setSelection(event.target.value); setDestinationId(""); setAmount(next ? Number(next.credit) > 0 ? next.credit : next.owes : "");
        }} required>{options.map((item) => <option key={`${item.playerId}:${item.seasonId}`} value={`${item.playerId}:${item.seasonId}`}>
          {item.playerName} ({item.playerId.slice(0, 8)}) - {item.seasonName} - {Number(item.credit) > 0 ? `${money(Number(item.credit))} credit` : `${money(Number(item.owes))} owing`}
        </option>)}</select>
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">Destination season
        <select className="input" value={destination?.id ?? ""} onChange={(event) => setDestinationId(event.target.value)} required>
          {destinations.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
        </select>
      </label>
      {destination ? <>
        <input type="hidden" name="player_id" value={selected?.playerId ?? ""} />
        <input type="hidden" name="source_season_id" value={selected?.seasonId ?? ""} />
        <input type="hidden" name="destination_season_id" value={destination.id} />
        <input type="hidden" name="submission_id" value={submissionId} />
        <input type="hidden" name="transfer_kind" value={transferKind} />
        <p className="text-sm text-slate-600">Transfer: <strong className="text-ink">{transferKind === "credit" ? "Credit" : "Amount owing"}</strong></p>
        <p className="text-sm text-slate-600">Source balance before: <strong className="text-ink">{balanceLabel(sourceCents)}</strong></p>
        <p className="text-sm text-slate-600">Destination balance before: <strong className="text-ink">{balanceLabel(targetCents)}</strong></p>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Amount to carry forward
          <input className="input" name="amount" type="number" min="0.01" max={availableAmount} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Transfer date
          <input className="input" name="transfer_date" type="date" max={today} defaultValue={today} required />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Note (optional)
          <input className="input" name="note" maxLength={300} />
        </label>
        {amountCents > 0 && amountCents <= availableCents ? <div className="grid gap-1 border-t border-slate-200 pt-3 text-sm text-slate-600">
          <span>Source balance after: {balanceLabel(sourceCents + (transferKind === "credit" ? -amountCents : amountCents))}</span>
          <span>Destination balance after: {balanceLabel(targetCents + (transferKind === "credit" ? amountCents : -amountCents))}</span>
        </div> : null}
        {state?.error ? <p className="text-sm text-rose-700" role="alert">{state.error}</p> : null}
        <SubmitButton />
      </> : <p className="text-sm text-slate-600">This program has no other season to receive a balance.</p>}
    </> : <p className="text-sm text-slate-600">No player balance has another season available in the same program.</p>}
  </form>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="btn-primary w-fit" disabled={pending}>{pending ? "Recording..." : "Carry forward balance"}</button>;
}

function balanceLabel(cents: number) {
  return `${money(Math.abs(cents) / 100)}${cents > 0 ? " credit" : cents < 0 ? " owing" : " (Settled)"}`;
}
