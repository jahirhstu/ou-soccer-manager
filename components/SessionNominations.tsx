"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePerformance } from "@/lib/actions/performance";
import {
  nomineeSelectedInAnotherCategory,
  nominationCategories,
  type NominationCategory,
  type PerformanceData
} from "../packages/contracts/src/performance";

export function SessionNominations({ data }: { data: PerformanceData }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Record<NominationCategory, string>>({
    goalkeeper: "",
    defender: "",
    midfielder: ""
  });
  const completedCategories = new Set((data.nominations ?? []).map((item) => item.category));
  const hasPlayedFixture = data.matches.some((match) => match.status === "played");
  const nominees = [...new Map(data.teams
    .flatMap((team) => team.players)
    .filter((player) => player.id !== data.voterPlayerId)
    .map((player) => [player.id, player])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));

  const submit = (operation: "authorize" | "close", payload: Record<string, unknown>) => start(async () => {
    setMessage("");
    try {
      const response = await updatePerformance(data.session.id, operation, payload);
      setMessage(response.error ?? "Saved.");
      if (!response.error) {
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save. Please retry.");
    }
  });

  const submitNominations = () => start(async () => {
    setMessage("");
    const pendingCategories = nominationCategories.filter((category) => selected[category]);
    let saved = 0;
    for (const category of pendingCategories) {
      const playerId = selected[category];
      try {
        const response = await updatePerformance(data.session.id, "nomination", { category, playerId });
        if (response.error) {
          setMessage(response.error);
          break;
        }
        saved += 1;
        setSelected((previous) => ({ ...previous, [category]: "" }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not save. Please retry.");
        break;
      }
    }
    if (saved > 0) router.refresh();
    if (saved > 0 && saved === pendingCategories.length) setMessage("Nominations saved.");
  });

  return <div className="grid gap-5">
    <div role="status" className="text-sm font-medium">{busy ? "Saving…" : message}</div>
    <section className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
      <div>
        <h2 className="section-title">{data.closed ? "Nominations closed" : data.session.status === "completed" ? "Nominations are read-only" : hasPlayedFixture ? "Nominations open" : "Nominations open after a fixture is marked played"}</h2>
        <p className="mt-1 text-sm text-slate-600">Maximum casting point is 20 per nomination. Each category allocates up to 60 nomination points.</p>
        {data.canNominate && <p className="mt-1 text-xs text-slate-500">Voting as {data.voters?.find((voter) => voter.playerId === data.voterPlayerId)?.name ?? "your linked player profile"}.</p>}
        {!data.canNominate && !data.canAuthorizeVoters && data.session.status !== "completed" && hasPlayedFixture && !data.closed &&
          <p className="mt-1 text-xs text-amber-800">You need an active player profile participating in this session or admin authorization to nominate.</p>}
      </div>
      {data.canClose && hasPlayedFixture && data.session.status !== "completed" && <button disabled={busy} className="btn-secondary" onClick={() => {
        if (window.confirm(data.closed ? "Reopen nominations?" : "Close nominations?")) {
          submit("close", { closed: !data.closed });
        }
      }}>{data.closed ? "Reopen nominations" : "Close nominations"}</button>}
    </section>

    <section aria-label="Nominations by player" className="grid gap-3">
      <div className="grid grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] gap-1.5 sm:gap-2">
        <div className="flex items-end rounded-md px-2 py-2 text-xs font-semibold uppercase text-slate-500 sm:px-3">Player</div>
        {nominationCategories.map((category) => {
          const label = `Top ${capitalize(category)}`;
          const awarded = data.awards.filter((award) => award.category === category);
          const voteInfo = data.voteCounts?.find((entry) => entry.category === category);
          const alreadyNominated = completedCategories.has(category);
          return <div className="min-w-0 rounded-md border border-line bg-slate-50 p-2 sm:p-3" key={category}>
            <h2 className="text-xs font-semibold leading-tight text-ink sm:text-sm">{label}</h2>
            <p className="mt-1 text-[10px] leading-tight text-slate-500 sm:text-xs">
              {voteInfo ? `${voteInfo.total} nominations · ${Number(voteInfo.pointsPerVote).toFixed(2)} pts each` : "No nominations yet"}
            </p>
            {awarded.map((award) => <p className="mt-1 break-words text-[10px] leading-tight text-ink sm:text-xs" key={award.player_id}>
              <strong>{award.player_name}</strong> · {award.nominations}
            </p>)}
            {alreadyNominated && <p className="mt-1 text-[10px] leading-tight text-emerald-800 sm:text-xs">Your vote is recorded</p>}
          </div>;
        })}
      </div>
      <p className="text-xs text-slate-600">Choose one player in each category. A player can only be nominated in one category by each voter.</p>
      <div className="grid gap-1.5">
        {nominees.map((player) => <div
          className="grid grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] gap-1.5 rounded-lg border border-line bg-white p-1.5 shadow-sm sm:gap-2 sm:p-2"
          key={player.id}
        >
          <div className="flex min-h-11 min-w-0 items-center px-1.5 py-1 text-xs font-medium text-ink sm:px-2 sm:text-sm">
            <span className="break-words">{player.name}</span>
          </div>
          {nominationCategories.map((category) => {
            const alreadyNominated = completedCategories.has(category);
            const isSelected = selected[category] === player.id;
            const usedInAnotherCategory = nomineeSelectedInAnotherCategory(player.id, category, data.nominations, selected);
            const canSelect = Boolean(data.canNominate) && !data.closed && data.session.status !== "completed" && !alreadyNominated && !usedInAnotherCategory;
            return <label
              className={`flex min-h-11 min-w-0 items-center justify-center rounded-md border transition ${isSelected ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-200" : "border-transparent bg-slate-50"} ${canSelect && !busy ? "cursor-pointer hover:border-emerald-300" : "cursor-not-allowed opacity-60"}`}
              key={category}
              title={`${player.name} — Top ${category}`}
            >
              <input
                aria-label={`Top ${capitalize(category)} nomination for ${player.name}`}
                checked={isSelected}
                className="h-5 w-5 accent-emerald-700"
                disabled={busy || !canSelect}
                onChange={() => setSelected((previous) => ({ ...previous, [category]: isSelected ? "" : player.id }))}
                type="checkbox"
              />
            </label>;
          })}
        </div>)}
        {!nominees.length && <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-slate-500">No other session participants to nominate.</p>}
      </div>
      {nominationCategories.some((category) => completedCategories.has(category)) && <p className="text-xs text-emerald-800">Your nomination for a completed category is recorded.</p>}
    </section>

    {data.canNominate && !data.closed && data.session.status !== "completed" && (
      <button
        className="btn-primary justify-self-start"
        disabled={busy || !nominationCategories.some((category) => selected[category])}
        onClick={submitNominations}
        type="button"
      >
        {busy ? "Submitting…" : "Submit Nominations"}
      </button>
    )}

    {data.canAuthorizeVoters && hasPlayedFixture && data.session.status !== "completed" && !data.closed && <section className="border-t border-line pt-4">
      <h2 className="section-title">Authorize nonparticipant voters</h2>
      <p className="mt-1 text-sm text-slate-500">Authorized players must have an active player-linked account in this program.</p>
      <div className="mt-3 divide-y divide-line">
        {(data.voters ?? []).filter((voter) => !voter.participated).map((voter) => <label className="flex items-center justify-between gap-3 py-2 text-sm" key={voter.playerId}>
          <span>{voter.name}</span>
          <span className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{voter.authorized ? "Authorized" : "Not authorized"}</span>
            <input type="checkbox" checked={voter.authorized} disabled={busy || data.closed} aria-label={`Authorize ${voter.name} to nominate`} onChange={(event) => submit("authorize", { playerId: voter.playerId, authorized: event.target.checked })} />
          </span>
        </label>)}
        {!(data.voters ?? []).some((voter) => !voter.participated) && <p className="py-2 text-sm text-slate-500">There are no nonparticipant program players to authorize.</p>}
      </div>
    </section>}
  </div>;
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
