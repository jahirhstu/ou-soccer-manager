"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { createInvitationAction } from "@/lib/actions/invitations";

type ProgramOption = { id: string; name: string };

export function InvitationForm({ programs }: { programs: ProgramOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [invitePath, setInvitePath] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createInvitationAction(formData);
      setInvitePath(result.path);
    });
  }

  return (
    <form className="panel grid gap-3 p-5" onSubmit={submit}>
      <div><h2 className="section-title">Create invitation</h2><p className="mt-1 text-sm text-slate-500">Privileged invitations are always single-use.</p></div>
      <input className="input" name="email" placeholder="Invited email (optional)" type="email" />
      <select className="input" name="organization_role" defaultValue="player">
        <option value="player">Organization member</option>
        <option value="admin">Organization admin</option>
        <option value="">No organization role change</option>
      </select>
      <select className="input" name="program_id" defaultValue="">
        <option value="">No specific program</option>
        {programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
      </select>
      <select className="input" name="program_role" defaultValue="">
        <option value="">No program role</option>
        <option value="manager">Program manager</option>
        <option value="captain">Captain</option>
        <option value="member">Player/member</option>
      </select>
      <input className="input" max="168" min="1" name="expires_in_hours" type="number" defaultValue="24" />
      <button className="btn-primary w-fit" disabled={isPending}>{isPending ? "Creating..." : "Create invitation"}</button>
      {invitePath ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 font-mono text-sm text-emerald-800">{window.location.origin}{invitePath}</div> : null}
    </form>
  );
}
