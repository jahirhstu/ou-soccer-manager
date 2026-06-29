"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { updateOrganizationUserPassword } from "@/lib/actions/admin";

export function UserPasswordForm({ memberId }: { memberId: string }) {
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim()) {
      toast.info("Password unchanged.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await updateOrganizationUserPassword(formData);
        setPassword("");
        toast.success("Password updated.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update password.");
      }
    });
  }

  return (
    <form className="grid gap-2" onSubmit={onSubmit}>
      <input name="member_id" type="hidden" value={memberId} />
      <input
        autoComplete="new-password"
        className="input min-h-9 px-2 text-sm"
        minLength={6}
        name="password"
        onChange={(event) => setPassword(event.target.value)}
        placeholder="New password"
        type="password"
        value={password}
      />
      <button className="btn-secondary min-h-9 w-fit px-3 text-xs" disabled={isPending || !password.trim()}>
        {isPending ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}
