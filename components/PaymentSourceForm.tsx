"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRightLeft } from "lucide-react";
import { transferPlayerCredit, type PlayerCreditState } from "@/lib/actions/player-credit";
import { amountInCents, centsAmount, creditTransferPreview, type CreditBalance } from "@/lib/player-credit";
import { money } from "@/lib/utils";

type Person = { id: string; display_name: string; status: string };
type Season = { id: string; name: string; program_id: string | null };
type Session = { id: string; season_id: string; name: string | null; session_date: string };
type Props = { children: ReactNode; initialSource: "external" | "credit"; players: Person[]; seasons: Season[];
  sessions: Session[]; balances: CreditBalance[]; submissionId: string; today: string };

export function PaymentSourceForm({ children, initialSource, ...props }: Props) {
  const [source, setSource] = useState(initialSource);
  return <div className="grid max-w-xl gap-4">
    <label className="grid gap-1 text-sm font-medium text-slate-700">Payment source
      <select aria-label="Payment source" className="input" value={source} onChange={event => setSource(event.target.value as typeof source)}>
        <option value="external">External payment</option>
        <option value="credit">Another player&apos;s credit</option>
      </select>
    </label>
    {source === "external" ? children : <PlayerCreditForm {...props} />}
  </div>;
}

function balanceLabel(cents: bigint) {
  return `${money(Number(centsAmount(cents < BigInt(0) ? -cents : cents)))}${cents > BigInt(0) ? " credit" : cents < BigInt(0) ? " owing" : " (Settled)"}`;
}

export function PlayerCreditForm({ players, seasons, sessions, balances, submissionId, today }: Omit<Props, "children" | "initialSource">) {
  const [seasonId, setSeasonId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [fundingId, setFundingId] = useState("");
  const [amount, setAmount] = useState("");
  const [state, action] = useActionState<PlayerCreditState, FormData>(transferPlayerCredit, null);
  const preview = creditTransferPreview(balances, seasonId, fundingId, recipientId, amount);
  const fundingPlayers = players.filter(player => player.id !== recipientId && (amountInCents(balances.find(row => row.playerId === player.id && row.seasonId === seasonId)?.credit ?? "0") ?? BigInt(0)) > BigInt(0));
  const recipient = players.find(player => player.id === recipientId);
  const funding = players.find(player => player.id === fundingId);
  function defaultAmount(from: string, to: string) {
    const owes = amountInCents(balances.find(row => row.playerId === to && row.seasonId === seasonId)?.owes ?? "0") ?? BigInt(0);
    const credit = amountInCents(balances.find(row => row.playerId === from && row.seasonId === seasonId)?.credit ?? "0") ?? BigInt(0);
    return owes > BigInt(0) && credit > BigInt(0) ? centsAmount(owes < credit ? owes : credit) : "";
  }
  const personLabel = (person: Person) => `${person.display_name} (${person.id.slice(0, 8)})${person.status === "inactive" ? " - inactive" : ""}`;
  return <form action={action} className="panel grid gap-4 p-5">
    <h1 className="section-title">Transfer player credit</h1>
    <input type="hidden" name="submission_id" value={submissionId} />
    <label className="grid gap-1 text-sm font-medium text-slate-700">Season
      <select aria-label="Season" className="input" name="season_id" value={seasonId} required onChange={event => { setSeasonId(event.target.value); setRecipientId(""); setFundingId(""); setAmount(""); }}>
        <option value="">Select season</option>{seasons.filter(season => season.program_id).map(season => <option key={season.id} value={season.id}>{season.name}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm font-medium text-slate-700">Recipient player
      <select aria-label="Recipient player" className="input" name="recipient_player_id" value={recipientId} required disabled={!seasonId} onChange={event => {
        const next = event.target.value; const from = next === fundingId ? "" : fundingId;
        setRecipientId(next); setFundingId(from); setAmount(defaultAmount(from, next));
      }}><option value="">Select recipient</option>{players.map(player => <option key={player.id} value={player.id}>{personLabel(player)}</option>)}</select>
    </label>
    <label className="grid gap-1 text-sm font-medium text-slate-700">Funding player
      <select aria-label="Funding player" className="input" name="funding_player_id" value={fundingId} required disabled={!seasonId} onChange={event => { setFundingId(event.target.value); setAmount(defaultAmount(event.target.value, recipientId)); }}>
        <option value="">Select player with credit</option>{fundingPlayers.map(player => <option key={player.id} value={player.id}>{personLabel(player)} - {balanceLabel(amountInCents(balances.find(row => row.playerId === player.id && row.seasonId === seasonId)!.credit)!)}</option>)}
      </select>
    </label>
    {seasonId && !fundingPlayers.length ? <p className="text-sm text-slate-600">No other player has available credit in this season.</p> : null}
    {fundingId && recipientId ? <div className="grid grid-cols-2 gap-3 border-y border-line py-3 text-sm">
      <div className="min-w-0"><div className="break-words font-semibold">{funding?.display_name}</div><div className="text-slate-600">Before: {balanceLabel(preview.source)}</div></div>
      <div className="min-w-0"><div className="break-words font-semibold">{recipient?.display_name}</div><div className="text-slate-600">Before: {balanceLabel(preview.target)}</div></div>
      {preview.valid ? <><div>After: <strong>{balanceLabel(preview.sourceAfter)}</strong></div><div>After: <strong>{balanceLabel(preview.targetAfter)}</strong></div></> : null}
    </div> : null}
    <label className="grid gap-1 text-sm font-medium text-slate-700">Amount
      <input className="input" type="number" name="amount" min="0.01" max={centsAmount(preview.available)} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} />
    </label>
    {amount && !preview.valid && fundingId && recipientId ? <p className="text-sm text-rose-700">Enter a positive amount no greater than the funding player&apos;s available credit.</p> : null}
    <label className="grid gap-1 text-sm font-medium text-slate-700">Transfer date<input className="input" name="transfer_date" type="date" max={today} defaultValue={today} required /></label>
    <label className="grid gap-1 text-sm font-medium text-slate-700">Session (optional)
      <select key={seasonId} aria-label="Session (optional)" className="input" name="session_id" disabled={!seasonId}><option value="">Season balance</option>{sessions.filter(session => session.season_id === seasonId).map(session => <option key={session.id} value={session.id}>{session.session_date} {session.name}</option>)}</select>
    </label>
    <label className="grid gap-1 text-sm font-medium text-slate-700">Note (optional)<textarea className="input min-h-20" name="note" maxLength={300} /></label>
    <label key={`${seasonId}:${fundingId}:${recipientId}:${amount}`} className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" name="confirmed" required className="mt-1" />Confirm transfer from {funding?.display_name ?? "funding player"} to {recipient?.display_name ?? "recipient"}.</label>
    {state?.error ? <p role="alert" className="text-sm text-rose-700">{state.error}</p> : null}
    <SubmitButton valid={preview.valid} />
  </form>;
}

function SubmitButton({ valid }: { valid: boolean }) {
  const { pending } = useFormStatus();
  return <button className="btn-primary inline-flex w-fit items-center gap-2" disabled={!valid || pending}><ArrowRightLeft className="h-4 w-4" />{pending ? "Recording..." : "Transfer credit"}</button>;
}
