import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  empty = "No records yet.",
  compact = false
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  compact?: boolean;
}) {
  if (!rows.length) {
    return <div className="panel border-dashed p-10 text-center text-sm text-slate-500">{empty}</div>;
  }

  return (
    <>
      <div className="grid gap-3 md:hidden">
        {rows.map((row, index) => (
          <div className="panel divide-y divide-line p-1" key={index}>
            {columns.map((column) => (
              <div className="grid grid-cols-[112px_1fr] gap-3 px-3 py-2.5 text-sm" key={column.header}>
                <div className="text-xs font-semibold uppercase text-slate-500">{column.header}</div>
                <div className="min-w-0 break-words text-right text-slate-700">{column.cell(row)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="panel hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className={cn("w-full border-collapse text-left text-sm", compact ? "min-w-0" : "min-w-[720px]")}>
            <thead className="border-b border-line bg-slate-50/80 text-xs uppercase text-slate-500">
              <tr>{columns.map((column) => <th className={cn("font-semibold tracking-normal", compact ? "px-3 py-2.5" : "px-4 py-3")} key={column.header}>{column.header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row, index) => (
                <tr className="transition hover:bg-emerald-50/40" key={index}>
                  {columns.map((column) => <td className={cn("align-top text-slate-700", compact ? "px-3 py-3" : "px-4 py-3.5")} key={column.header}>{column.cell(row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
