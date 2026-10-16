import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ selects: [] as string[], profile: { role: "admin", organization_id: "org" } as any }));
vi.mock("../../app/(shell)", () => ({ AppShell: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/PaymentFlashToast", () => ({ PaymentFlashToast: () => null }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => mock.profile, getCurrentProgram: async () => ({ id: "program", name: "Football" }), createSupabaseServerClient: async () => ({
  from: (table: string) => {
    let playerId = "";
    const people = [{ id: "funding", display_name: "Host", status: "active" }, { id: "guest", display_name: "Guest", status: "inactive" }];
    const ledger = [
      { id: "out", transfer_id: "transfer", type: "credit_transferred_out", player_id: "funding", related_player_id: "guest", amount: "13.00", transfer_date: "2026-10-04", seasons: { name: "Fall" }, players: { display_name: "Host" }, counterparty: { display_name: "Guest" }, description: "Credit sent to Guest", transfer_note: "Guest fee" },
      { id: "in", transfer_id: "transfer", type: "credit_transferred_in", player_id: "guest", related_player_id: "funding", amount: "13.00", transfer_date: "2026-10-04", seasons: { name: "Fall" }, players: { display_name: "Guest" }, counterparty: { display_name: "Host" }, description: "Credit received from Host", transfer_note: "Guest fee" }
    ];
    const query: any = {
      select: (value: string) => { mock.selects.push(value); return query; },
      eq: (key: string, value: string) => { if (key === "player_id" || (table === "players" && key === "id")) playerId = value; return query; },
      gt: () => query, order: () => query, in: () => query, not: () => query,
      single: () => Promise.resolve({ data: people.find(p => p.id === playerId), error: null }),
      then: (resolve: any) => {
        let data: any[] = [];
        if (table === "players") data = people;
        if (table === "seasons") data = [{ id: "fall", name: "Fall", program_id: "program" }];
        if (table === "ledger_entries") data = ledger.filter(row => !playerId || row.player_id === playerId);
        if (table === "player_season_payment_summary") data = people.map(person => ({ player_id: person.id, player_name: person.display_name, season_id: "fall", season_name: "Fall", total_paid_amount: person.id === "funding" ? 40 : 0, credit_amount: person.id === "funding" ? 27 : 0, owes_money: 0 })).filter(row => !playerId || row.player_id === playerId);
        if (table === "player_season_transfer_summary") data = [{ player_id: "funding", season_id: "fall", transfer_out_amount: 13 }, { player_id: "guest", season_id: "fall", transfer_in_amount: 13 }];
        return Promise.resolve({ data, error: null }).then(resolve);
      }
    }; return query;
  }
}) }));

import PaymentsPage from "../../app/payments/page";
import PlayerPage from "../../app/players/[id]/page";
import PaymentReportPage from "../../app/reports/payments/page";
import NewPaymentPage from "../../app/payments/new/page";

beforeEach(() => { mock.selects.length = 0; mock.profile = { role: "admin", organization_id: "org" }; });

describe("player credit page integration", () => {
  it("shows both directions and exports one transfer rather than counting both sides", async () => {
    const html = renderToStaticMarkup(await PaymentsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Credit sent to Guest"); expect(html).toContain("Credit received from Host");
    expect(html).toContain("/payments/new?source=credit");
    const href = html.match(/download="player-credit-transfers.csv" href="([^"]+)"/)![1];
    const csv = decodeURIComponent(href.slice(href.indexOf(",") + 1));
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('"funding","Host","guest","Guest","13.00"');
    expect(mock.selects.some(value => value.includes("players!ledger_entries_player_id_fkey"))).toBe(true);
  });
  it("identifies the counterparty on each player's history", async () => {
    const host = renderToStaticMarkup(await PlayerPage({ params: Promise.resolve({ id: "funding" }) }));
    const guest = renderToStaticMarkup(await PlayerPage({ params: Promise.resolve({ id: "guest" }) }));
    expect(host).toContain("Credit sent to Guest");
    expect(guest).toContain("Credit received from Host");
  });
  it("keeps transferred debt settlement visible in report and CSV without adding cash paid", async () => {
    const html = renderToStaticMarkup(await PaymentReportPage({ searchParams: Promise.resolve({ status: "settled" }) }));
    const href = html.match(/href="(data:text\/csv[^\"]+)"/)![1];
    const csv = decodeURIComponent(href.slice(href.indexOf(",") + 1));
    const cells = csv.split("\n")[1].split(",");
    expect(csv.split("\n")).toHaveLength(2);
    expect(cells[0]).toBe("Guest"); expect(cells[2]).toBe("0"); expect(cells[9]).toBe("13");
  });
  it("opens the transfer shortcut and preserves the external form by default", async () => {
    const credit = renderToStaticMarkup(await NewPaymentPage({ searchParams: Promise.resolve({ source: "credit" }) }));
    expect(credit).toContain("Transfer player credit"); expect(credit).not.toContain('name="payment_method"');
    const external = renderToStaticMarkup(await NewPaymentPage({ searchParams: Promise.resolve({}) }));
    expect(external).toContain('name="payment_method"'); expect(external).toContain('name="sessions_covered"');
    mock.profile = { role: "captain", organization_id: "org" };
    await expect(NewPaymentPage({ searchParams: Promise.resolve({ source: "credit" }) })).rejects.toThrow("redirect:/public/report");
  });
});
