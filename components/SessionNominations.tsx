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

  const submit = (operation: "nomination" | "authorize" | "close", payload: Record<string, unknown>) => start(async () => {
    setMessage("");
    try {
      const response = await updatePerformance(data.session.id, operation, payload);
      setMessage(response.error ?? "Saved.");
      if (!response.error) {
        setSelected({ goalkeeper: "", defender: "", midfielder: "" });
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save. Please retry.");
    }
  });

  return <div className="grid gap-5">
    <div role="status" className="text-sm font-medium">{busy ? "Saving…" : message}</div>
    <section className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
      <div>
        <h2 className="section-title">{data.closed ? "Nominations closed" : data.session.status === "completed" ? "Nominations open" : "Nominations open after session completion"}</h2>
        <p className="mt-1 text-sm text-slate-600">Maximum casting point is 20 per nomination. Each category allocates up to 60 nomination points.</p>
        {data.canNominate && <p className="mt-1 text-xs text-slate-500">Voting as {data.voters?.find((voter) => voter.playerId === data.voterPlayerId)?.name ?? "your linked player profile"}.</p>}
        {!data.canNominate && !data.canAuthorizeVoters && data.session.status === "completed" && !data.closed &&
          <p className="mt-1 text-xs text-amber-800">You need an active player profile participating in this session or admin authorization to nominate.</p>}
      </div>
      {data.canClose && <button disabled={busy} className="btn-secondary" onClick={() => {
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
        const nominees = [...new Map(data.details
          .filter((detail) => detail.position === category && detail.player_id !== data.voterPlayerId)
          .map((detail) => [detail.player_id, detail])).values()]
          .sort((left, right) => left.player_name.localeCompare(right.player_name));
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
          {data.canNominate && !data.closed && !alreadyNominated && data.session.status === "completed" && <form className="mt-3 grid gap-2" onSubmit={(event) => {
            event.preventDefault();
            if (selected[category]) submit("nomination", { category, playerId: selected[category] });
          }}>
            <label className="grid gap-1 text-sm font-medium" htmlFor={`nominee-${category}`}>{label} nomination
              <select id={`nominee-${category}`} className="input" value={selected[category]} onChange={(event) => setSelected((previous) => ({ ...previous, [category]: event.target.value }))} required>
                <option value="">Select a player</option>
                {nominees.map((player) => <option value={player.player_id} key={player.player_id}>{player.player_name}</option>)}
              </select>
            </label>
            <button disabled={busy || !nominees.length || !selected[category]} className="btn-secondary">Submit nomination</button>
          </form>}
          {alreadyNominated && <p className="mt-3 text-xs text-emerald-800">Your nomination for this category is recorded.</p>}
        </section>;
      })}
    </div>

    {data.canAuthorizeVoters && <section className="border-t border-line pt-4">
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
