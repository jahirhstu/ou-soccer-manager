"use client";

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export function ConfirmDialog({ children, message = "Are you sure?" }: { children?: ReactNode; message?: string }) {
  return (
    <button
      className="inline-flex min-h-9 items-center gap-2 rounded border border-rose-200 px-3 text-sm font-medium text-rose-700 hover:bg-rose-50"
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
      type="submit"
    >
      <Trash2 className="h-4 w-4" />
      {children ?? "Delete"}
    </button>
  );
}
