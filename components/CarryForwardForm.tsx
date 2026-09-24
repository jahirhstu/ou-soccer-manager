"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { carryForwardPlayerCredit, type TransferActionState } from "@/lib/actions/transfers";
import { money } from "@/lib/utils";

type Source = { playerId: string; playerName: string; seasonId: string; seasonName: string; programId: string; credit: string };
type Season = { id: string; name: string; program_id: string };
type Balance = { playerId: string; seasonId: string; credit: string; owes: string };

export function CarryForwardForm({ options, seasons, balances, initialPlayerId, initialSeasonId, submissionId, today }: {
  options: Source[]; seasons: Season[]; balances: Balance[];
  initialPlayerId?: string; initialSeasonId?: string; submissionId: string; today: string;
}) {
  const initial = options.find((item) => item.playerId === initialPlayerId && item.seasonId === initialSeasonId) ?? options[0];
  const [selection, setSelection] = useState(initial ? `${initial.playerId}:${initial.seasonId}` : "");
  const [destinationId, setDestinationId] = useState("");
  const [amount, setAmount] = useState(initial?.credit ?? "");
  const [state, action] = useActionState<TransferActionState, FormData>(carryForwardPlayerCredit, null);
  const selected = options.find((item) => `${item.playerId}:${item.seasonId}` === selection);
  const destinations = useMemo(() => seasons.filter((season) => selected && season.program_id === selected.programId && season.id !== selected.seasonId), [seasons, selected]);
  const destination = destinations.find((season) => season.id === destinationId) ?? destinations[0];
  const target = balances.find((row) => row.playerId === selected?.playerId && row.seasonId === destination?.id);
  const sourceCents = Math.round(Number(selected?.credit ?? 0) * 100);
  const amountCents = Math.round(Number(amount || 0) * 100);
  const targetCents = Math.round((Number(target?.credit ?? 0) - Number(target?.owes ?? 0)) * 100);

  return <form action={action} className="panel grid max-w-xl gap-4 p-5">
    <h1 className="section-title">Carry forward credit</h1>
    {options.length ? <>
      <label className="grid gap-1 text-sm font-medium text-slate-700">Player and source season
        <select className="input" value={selection} onChange={(event) => {
          const next = options.find((item) => `${item.playerId}:${item.seasonId}` === event.target.value);
          setSelection(event.target.value); setDestinationId(""); setAmount(next?.credit ?? "");
        }} required>{options.map((item) => <option key={`${item.playerId}:${item.seasonId}`} value={`${item.playerId}:${item.seasonId}`}>
          {item.playerName} ({item.playerId.slice(0, 8)}) - {item.seasonName} - {money(Number(item.credit))}
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
        <p className="text-sm text-slate-600">Available source credit: <strong className="text-ink">{money(Number(selected?.credit ?? 0))}</strong></p>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Amount to carry forward
          <input className="input" name="amount" type="number" min="0.01" max={selected?.credit} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Transfer date
          <input className="input" name="transfer_date" type="date" max={today} defaultValue={today} required />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Note (optional)
          <input className="input" name="note" maxLength={300} />
        </label>
        {amountCents > 0 && amountCents <= sourceCents ? <div className="grid gap-1 border-t border-slate-200 pt-3 text-sm text-slate-600">
          <span>Source credit after: {money((sourceCents - amountCents) / 100)}</span>
          <span>Destination balance after: {money((targetCents + amountCents) / 100)}{targetCents < 0 ? " (existing debt applied first)" : ""}</span>
        </div> : null}
        {state?.error ? <p className="text-sm text-rose-700" role="alert">{state.error}</p> : null}
        <SubmitButton />
      </> : <p className="text-sm text-slate-600">This program has no other season to receive credit.</p>}
    </> : <p className="text-sm text-slate-600">No player credit has another season available in the same program.</p>}
  </form>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="btn-primary w-fit" disabled={pending}>{pending ? "Recording..." : "Carry forward credit"}</button>;
}
