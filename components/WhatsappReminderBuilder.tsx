"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, Send } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/utils";

export type WhatsappReminderRow = {
  playerId: string;
  playerName: string;
  seasonId: string;
  seasonName: string;
  amount: number;
  phone: string;
  pendingPaymentSent: boolean;
};

const interacEmail = "jahirhstu2@gmail.com";
const appLink = "https://ou-soccer-manager.vercel.app/";
const paymentSentGuidePath = "/payment-sent-guide.png";
const confirmationLine = `Confirm payment by click on the Sent button beside your name in the app. App link: ${appLink}`;

export function WhatsappReminderBuilder({ rows }: { rows: WhatsappReminderRow[] }) {
  const [selected, setSelected] = useState(() => new Set(rows.filter((row) => !row.pendingPaymentSent).map(rowKey)));
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(rowKey(row))), [rows, selected]);
  const allSelectableKeys = rows.filter((row) => !row.pendingPaymentSent).map(rowKey);
  const allSelectableSelected = allSelectableKeys.length > 0 && allSelectableKeys.every((key) => selected.has(key));
  const groupMessage = buildGroupMessage(selectedRows);

  function toggle(row: WhatsappReminderRow) {
    const key = rowKey(row);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelectableSelected) {
        allSelectableKeys.forEach((key) => next.delete(key));
      } else {
        allSelectableKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  }

  async function copyMessage(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success("Reminder copied.");
  }

  return (
    <div className="grid gap-5">
      <section className="panel grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Draft</h2>
            <p className="text-sm font-medium text-slate-500">{selectedRows.length} selected</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary min-h-9 px-3 text-sm" onClick={toggleAll} type="button">
              <Check className="h-4 w-4" />
              {allSelectableSelected ? "Clear" : "Select all"}
            </button>
            <button className="btn-primary min-h-9 px-3 text-sm" disabled={!selectedRows.length} onClick={() => copyMessage(groupMessage)} type="button">
              <Copy className="h-4 w-4" />
              Copy group draft
            </button>
          </div>
        </div>
        <div className="grid gap-3 rounded-md border border-line bg-slate-50 p-3 md:grid-cols-[160px_1fr]">
          <img alt="Sent button guide" className="w-full rounded-md border border-line bg-white" src={paymentSentGuidePath} />
          <div className="grid content-start gap-2">
            <div className="text-sm font-semibold text-ink">Attach this image in WhatsApp</div>
            <p className="text-sm text-slate-600">
              WhatsApp links can only prefill text. Download or open this image, attach it in WhatsApp, then paste/send the draft below.
            </p>
            <div className="flex flex-wrap gap-2">
              <a className="btn-secondary min-h-9 px-3 text-xs" download="payment-sent-guide.png" href={paymentSentGuidePath}>
                <Download className="h-3.5 w-3.5" />
                Download image
              </a>
              <a className="btn-secondary min-h-9 px-3 text-xs" href={paymentSentGuidePath} rel="noopener noreferrer" target="_blank">
                Open image
              </a>
            </div>
          </div>
        </div>
        <textarea className="input min-h-48 font-mono text-sm" readOnly value={groupMessage} />
      </section>

      <section className="grid gap-3">
        {rows.map((row) => {
          const key = rowKey(row);
          const selectedRow = selected.has(key);
          const personalMessage = buildPersonalMessage(row);
          const whatsappHref = whatsappLink(row.phone, personalMessage);
          return (
            <article className={`rounded-lg border bg-white p-4 shadow-sm ${selectedRow ? "border-emerald-300 ring-1 ring-emerald-100" : "border-line"}`} key={key}>
              <div className="grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-start">
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input checked={selectedRow} className="h-4 w-4 accent-emerald-600" onChange={() => toggle(row)} type="checkbox" />
                  Select
                </label>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ink">{row.playerName}</h3>
                    <span className="rounded-md bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                      Owes {money(row.amount)}
                    </span>
                    {row.pendingPaymentSent ? (
                      <span className="rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                        Payment sent pending
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-500">{row.seasonName}</div>
                  <textarea className="input mt-3 min-h-28 text-sm" readOnly value={personalMessage} />
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button className="btn-secondary min-h-9 px-3 text-xs" onClick={() => copyMessage(personalMessage)} type="button">
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  {whatsappHref ? (
                    <a className="btn-primary min-h-9 px-3 text-xs" href={whatsappHref} rel="noopener noreferrer" target="_blank">
                      <Send className="h-3.5 w-3.5" />
                      WhatsApp
                    </a>
                  ) : (
                    <span className="inline-flex min-h-9 items-center rounded-md border border-line bg-slate-50 px-3 text-xs font-semibold text-slate-500">
                      No phone
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {!rows.length ? (
          <div className="panel border-dashed p-10 text-center text-sm text-slate-500">No players currently owe money.</div>
        ) : null}
      </section>
    </div>
  );
}

function rowKey(row: WhatsappReminderRow) {
  return `${row.playerId}:${row.seasonId}`;
}

function buildGroupMessage(rows: WhatsappReminderRow[]) {
  if (!rows.length) return "No players selected.";
  return [
    "OU Soccer payment reminders:",
    "",
    ...rows.map((row) => `- ${row.playerName}: ${money(row.amount)}`),
    "",
    `Please send Interac to ${interacEmail}.`,
    confirmationLine
  ].join("\n");
}

function buildPersonalMessage(row: WhatsappReminderRow) {
  return [
    `Hi ${firstName(row.playerName)}, friendly reminder: you currently owe ${money(row.amount)} for OU Soccer.`,
    `Please send Interac to ${interacEmail}.`,
    confirmationLine
  ].join("\n\n");
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || value;
}

function whatsappLink(phone: string, message: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function normalizePhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `1${digits}`;
  return digits;
}
