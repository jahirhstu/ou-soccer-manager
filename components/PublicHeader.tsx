import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function PublicHeader({
  returnHref,
  returnLabel
}: {
  returnHref?: string;
  returnLabel?: string;
}) {
  return (
    <header className="border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-4 sm:py-3">
        <Link className="inline-flex min-w-0 items-center gap-3 font-semibold text-ink" href="/public/report">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-pitch text-sm font-bold text-white shadow-sm">OU</span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate">Soccer Manager</span>
            <span className="block text-xs font-medium text-slate-500">Report Gallery</span>
          </span>
        </Link>
        {returnHref ? (
          <Link className="btn-secondary min-h-9 px-3 text-xs sm:text-sm" href={returnHref}>
            <ArrowLeft className="h-4 w-4" />
            {returnLabel ?? "Return"}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
