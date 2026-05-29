"use client";

import { useActionState, useEffect } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { saveLeagueTeam } from "@/lib/actions/leagues";

type PlayerOption = {
  id: string;
  display_name: string;
};

export function LeagueTeamForm({ leagueId, players }: { leagueId: string; players: PlayerOption[] }) {
  const [state, action, pending] = useActionState(saveLeagueTeam, null as { success?: boolean; message?: string; error?: string } | null);

  useEffect(() => {
    if (state?.success) toast.success(state.message ?? "League team saved.");
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="panel grid gap-3 p-4">
      <input name="league_id" type="hidden" value={leagueId} />
      <div className="grid gap-2 md:grid-cols-[1fr_180px]">
        <input className="input" name="name" placeholder="Team name" required />
        <input className="input" min="1" name="seed_order" placeholder="Seed order" type="number" />
      </div>
      <select className="input" name="captain_player_id">
        <option value="">Select captain</option>
        {players.map((player) => <option key={player.id} value={player.id}>{player.display_name}</option>)}
      </select>
      <div className="grid max-h-56 gap-2 overflow-auto rounded-md border border-line bg-white p-3 sm:grid-cols-2">
        {players.map((player) => (
          <label className="flex min-h-8 items-center gap-2 text-sm text-slate-700" key={player.id}>
            <input className="h-4 w-4 rounded border-line" name="player_ids" type="checkbox" value={player.id} />
            <span>{player.display_name}</span>
          </label>
        ))}
      </div>
      <button className="btn-primary w-fit" disabled={pending}>
        <Plus className="h-4 w-4" />
        {pending ? "Saving..." : "Add team"}
      </button>
    </form>
  );
}
