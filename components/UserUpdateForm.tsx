"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateOrganizationUser } from "@/lib/actions/admin";

const roleOptions = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "captain", label: "Captain" },
  { value: "player", label: "Player" }
];

type PlayerOption = {
  id: string;
  display_name: string;
};

export function UserUpdateForm({
  memberId,
  playerId,
  players,
  role
}: {
  memberId: string;
  playerId?: string | null;
  players: PlayerOption[];
  role: string;
}) {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState(role);
  const [selectedPlayerId, setSelectedPlayerId] = useState(playerId ?? "");
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await updateOrganizationUser(formData);
        router.refresh();
        toast.success("User data saved.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save user data.");
      }
    });
  }

  return (
    <form className="grid gap-2" onSubmit={onSubmit}>
      <input name="member_id" type="hidden" value={memberId} />
      <select className="input min-h-9 px-2 text-sm" name="role" onChange={(event) => setSelectedRole(event.target.value)} value={selectedRole}>
        {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select className="input min-h-9 px-2 text-sm" name="player_id" onChange={(event) => setSelectedPlayerId(event.target.value)} value={selectedPlayerId}>
        <option value="">No player mapping</option>
        {players.map((player) => <option key={player.id} value={player.id}>{player.display_name}</option>)}
      </select>
      <button className="btn-secondary min-h-9 w-fit px-3 text-xs" disabled={isPending}>
        {isPending ? "Saving..." : "Update"}
      </button>
    </form>
  );
}
