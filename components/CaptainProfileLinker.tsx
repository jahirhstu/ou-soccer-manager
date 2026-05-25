"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { linkCaptainPlayerProfile } from "@/lib/actions/session-management";

type PlayerOption = {
  id: string;
  display_name: string;
};

export function CaptainProfileLinker({ players, sessionId }: { players: PlayerOption[]; sessionId: string }) {
  const [state, action, pending] = useActionState(linkCaptainPlayerProfile, null as { success?: boolean; message?: string; error?: string } | null);

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message ?? "Captain profile linked.");
      window.location.reload();
    }
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="panel grid gap-4 border-amber-200 bg-amber-50 p-5 text-left">
      <input name="sessionId" type="hidden" value={sessionId} />
      <div>
        <h2 className="text-base font-semibold text-amber-950">Link your captain account</h2>
        <p className="mt-1 text-sm text-amber-800">
          Your captain account is not linked to a player profile yet. Choose your own player profile below. This is a one-time option and cannot be changed here after saving.
        </p>
      </div>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Existing player profile
        <select className="input bg-white" name="playerId" required>
          <option value="">Select your player profile</option>
          {players.map((player) => <option key={player.id} value={player.id}>{player.display_name}</option>)}
        </select>
      </label>
      <button className="btn-primary w-fit" disabled={pending}>
        {pending ? "Linking..." : "Link profile"}
      </button>
    </form>
  );
}
