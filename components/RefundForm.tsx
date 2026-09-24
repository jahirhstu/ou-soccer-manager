"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { recordPlayerRefund, type RefundActionState } from "@/lib/actions/refunds";
import { money } from "@/lib/utils";

type CreditOption = {
  playerId: string;
  playerName: string;
  seasonId: string;
  seasonName: string;
  credit: string;
};

export function RefundForm({
  options,
  initialPlayerId,
  initialSeasonId,
  submissionId,
  today
}: {
  options: CreditOption[];
  initialPlayerId?: string;
  initialSeasonId?: string;
  submissionId: string;
  today: string;
}) {
  const initialOption = options.find((option) => option.playerId === initialPlayerId && option.seasonId === initialSeasonId) ?? options[0];
  const [selection, setSelection] = useState(initialOption ? `${initialOption.playerId}:${initialOption.seasonId}` : "");
  const [state, formAction] = useActionState<RefundActionState, FormData>(recordPlayerRefund, null);
  const selected = useMemo(() => options.find((option) => `${option.playerId}:${option.seasonId}` === selection), [options, selection]);

  return (
    <form action={formAction} className="panel grid max-w-xl gap-4 p-5">
      <h1 className="section-title">Record refund</h1>
      {options.length ? (
        <>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Player and season
            <select className="input" value={selection} onChange={(event) => setSelection(event.target.value)} required>
              {options.map((option) => (
                <option key={`${option.playerId}:${option.seasonId}`} value={`${option.playerId}:${option.seasonId}`}>
                  {option.playerName} ({option.playerId.slice(0, 8)}) - {option.seasonName} - {money(Number(option.credit))}
                </option>
              ))}
            </select>
          </label>
          <input type="hidden" name="player_id" value={selected?.playerId ?? ""} />
          <input type="hidden" name="season_id" value={selected?.seasonId ?? ""} />
          <input type="hidden" name="submission_id" value={submissionId} />
          <p className="text-sm text-slate-600">Available credit: <strong className="text-ink">{money(Number(selected?.credit ?? 0))}</strong></p>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Amount sent
            <input className="input" name="amount" type="number" min="0.01" max={selected?.credit} step="0.01" defaultValue={selected?.credit} key={selection} required />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Date sent
            <input className="input" name="refund_date" type="date" max={today} defaultValue={today} required />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Method
            <select className="input" name="method" defaultValue="e-transfer">
              <option value="e-transfer">E-transfer</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Transfer reference (optional)
            <input className="input" name="reference" maxLength={300} />
          </label>
          {state?.error ? <p className="text-sm text-rose-700" role="alert">{state.error}</p> : null}
          <SubmitButton />
        </>
      ) : (
        <p className="text-sm text-slate-600">No players currently have refundable credit.</p>
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="btn-primary w-fit" disabled={pending}>{pending ? "Recording..." : "Record completed refund"}</button>;
}
