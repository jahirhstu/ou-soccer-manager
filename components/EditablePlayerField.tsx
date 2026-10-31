"use client";

import { useState, useTransition } from "react";
import { updatePlayerField } from "@/lib/actions/crud";

type EditableField = "phone" | "email" | "preferred_position";
const positions = ["goalkeeper", "defender", "midfielder", "forward"] as const;

export function EditablePlayerField({
  canEdit,
  field,
  playerId,
  playerName,
  value
}: {
  canEdit: boolean;
  field: EditableField;
  playerId: string;
  playerName: string;
  value: string | null;
}) {
  const [current, setCurrent] = useState(value ?? "");
  const [draft, setDraft] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const label = field === "preferred_position" ? "default position" : field;

  function save(nextValue = draft) {
    setError("");
    startTransition(async () => {
      const result = await updatePlayerField(playerId, field, nextValue);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCurrent(nextValue);
      setDraft(nextValue);
      setEditing(false);
    });
  }

  if (field === "preferred_position") {
    return <div>
      <select
        aria-label={`${playerName} default position`}
        className="input min-w-32"
        disabled={!canEdit || pending}
        onChange={(event) => save(event.target.value)}
        value={current}
      >
        <option value="">No default position</option>
        {positions.map((position) => <option key={position} value={position}>{capitalize(position)}</option>)}
      </select>
      {error && <p className="mt-1 text-xs text-red-700" role="alert">{error}</p>}
    </div>;
  }

  if (!canEdit) return <span>{current || "-"}</span>;

  if (editing) {
    return <form className="flex min-w-40 items-center gap-1" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <input
        aria-label={`Edit ${label} for ${playerName}`}
        autoFocus
        className="input min-w-0"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") { setDraft(current); setEditing(false); } }}
        type={field === "email" ? "email" : "tel"}
        value={draft}
      />
      <button className="btn-secondary px-2 py-1" disabled={pending} type="submit">{pending ? "…" : "Save"}</button>
      <button className="btn-secondary px-2 py-1" disabled={pending} onClick={() => { setDraft(current); setEditing(false); }} type="button">Cancel</button>
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
    </form>;
  }

  return <button
    aria-label={`Edit ${label} for ${playerName}`}
    className="min-h-8 rounded px-1 text-left hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pitch"
    onClick={() => { setDraft(current); setEditing(true); }}
    onDoubleClick={() => { setDraft(current); setEditing(true); }}
    title="Click to edit"
    type="button"
  >{current || <span className="text-slate-400">Add {label}</span>}</button>;
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
