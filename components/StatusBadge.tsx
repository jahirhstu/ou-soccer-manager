import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  completed: "bg-slate-100 text-slate-700 ring-slate-200",
  archived: "bg-slate-100 text-slate-700 ring-slate-200",
  draft: "bg-amber-50 text-amber-800 ring-amber-200",
  dropped: "bg-rose-50 text-rose-700 ring-rose-200",
  replacement: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  played: "bg-emerald-50 text-emerald-700 ring-emerald-200"
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold capitalize ring-1", tones[status] ?? "bg-slate-50 text-slate-700 ring-slate-200")}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
