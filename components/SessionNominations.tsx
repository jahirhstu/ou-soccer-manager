"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePerformance } from "@/lib/actions/performance";
import type { PerformanceData } from "../packages/contracts/src/performance";

const categories = ["goalkeeper", "defender", "midfielder"] as const;
type Category = typeof categories[number];

export function SessionNominations({ data }: { data: PerformanceData }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Record<Category, string>>({
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
    const pendingCategories = categories.filter((category) => selected[category]);
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

    <div className="grid gap-4 md:grid-cols-3">
      {categories.map((category) => {
        const label = `Top ${capitalize(category)}`;
        const awarded = data.awards.filter((award) => award.category === category);
        const voteInfo = data.voteCounts?.find((entry) => entry.category === category);
        const alreadyNominated = completedCategories.has(category);
        return <section className="rounded-lg border border-line p-4" key={category}>
          <h2 className="section-title">{label}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {voteInfo ? `${voteInfo.total} valid nominations · ${Number(voteInfo.pointsPerVote).toFixed(2)} points per nomination` : "No nominations yet · up to 20 points per vote"}
          </p>
          <div className="mt-3 min-h-12">
            {awarded.map((award) => <p className="text-sm" key={award.player_id}>
              <strong>{award.player_name}</strong> · {award.nominations} nomination{award.nominations === 1 ? "" : "s"}
            </p>)}
            {!awarded.length && <p className="text-sm text-slate-500">No nominations yet.</p>}
          </div>
          {alreadyNominated && <p className="mt-3 text-xs text-emerald-800">Your nomination for this category is recorded.</p>}
          {data.canNominate && !data.closed && !alreadyNominated && data.session.status !== "completed" && (
            <div className="mt-3 grid gap-2">
              <p className="text-xs font-medium text-slate-600">Choose one player. The same player can be selected in other categories.</p>
              <div aria-label={`${label} nomination players`} className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line p-1.5" role="radiogroup">
                {nominees.map((player) => {
                  const isSelected = selected[category] === player.id;
                  return <button
                    aria-checked={isSelected}
                    className={`min-h-10 rounded-md border px-3 py-2 text-left text-sm transition ${isSelected ? "border-emerald-600 bg-emerald-50 font-semibold text-emerald-950 ring-1 ring-emerald-200" : "border-transparent text-slate-700 hover:border-line hover:bg-slate-50"}`}
                    disabled={busy}
                    key={player.id}
                    onClick={() => setSelected((previous) => ({ ...previous, [category]: isSelected ? "" : player.id }))}
                    role="radio"
                    type="button"
                  >
                    {player.name}
                  </button>;
                })}
                {!nominees.length && <p className="px-3 py-2 text-sm text-slate-500">No other session participants to nominate.</p>}
              </div>
            </div>
          )}
        </section>;
      })}
    </div>

    {data.canNominate && !data.closed && data.session.status !== "completed" && (
      <button
        className="btn-primary justify-self-start"
        disabled={busy || !categories.some((category) => selected[category])}
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
