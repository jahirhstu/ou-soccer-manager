import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeImportedPaymentAmountSource } from "../import-payment-source";
import { RuleBasedWhatsAppParser } from "../parsers/rule-based";
import { normalizeParsedJson } from "../parsers/llm-shared";

const mocks = vi.hoisted(() => ({ from: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("../supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from }),
  getCurrentProfile: async () => ({ id: "admin", role: "admin" })
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../parsers", () => ({ whatsappParser: { parse: vi.fn() } }));
vi.mock("../actions/session-usage", () => ({ applySessionUsage: vi.fn() }));

import { confirmWhatsAppImport } from "../actions/import";

const fall = "6c14cad3-7174-46e3-8598-3de6196e58b9";
const summer = "3d3e9d51-1f97-4899-8046-89ecac4cd1b4";
const names = ["Jahir", "Shaifu", "Arnab", "Morshadul", "Ahmed", "Sadat", "Naveed", "Shimul", "Rafiul", "Rocky", "Rokibul", "Hazem", "Towhid", "Shihan", "Wali", "Mash", "Mustaqim", "Arif", "Moshee", "Shafayet", "Shomi"];
const players = names.map((display_name, index) => ({ id: `player-${index}`, display_name }));
const rawText = `Season Signup\nSeason: Fall 2026\nFull season cost: $195\nPlayers:\n${names.map((name, index) => `${index + 1}. ${name}${["Wali", "Mash"].includes(name) ? "" : ` - $${name === "Shomi" ? 123 : 195} Paid`}`).join("\n")}`;
let records: Record<string, any[]>;

function form() {
  const data = new FormData();
  data.set("seasonId", fall);
  data.set("rawText", rawText);
  data.set("createSeasonName", "Fall 2026");
  data.set("parsedJson", JSON.stringify({
    rawText, importType: "season_signup", confidence: "high",
    players: names.map((name) => ({ name })),
    payments: names.filter((name) => !["Wali", "Mash"].includes(name)).map((playerName) => ({
      playerName, amount: playerName === "Shomi" ? 123 : 195,
      amountSource: "player_line", note: "Paid", paymentMethod: "e-transfer"
    })),
    attendance: [], dropouts: [], teams: [], matches: [], goals: [], warnings: []
  }));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  records = { payments: [], ledger_entries: [], whatsapp_imports: [], audit_logs: [] };
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    let mutation: any;
    const result = () => {
      if (mutation) return { data: mutation, error: null };
      if (table === "players") return { data: players, error: null };
      const rows = (records[table] ?? []).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
      return { data: rows, error: null };
    };
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      insert: (payload: any) => {
        const index = records[table]?.length ?? 0;
        const id = table === "whatsapp_imports"
          ? `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`
          : `${table}-${index}`;
        mutation = { ...payload, id };
        (records[table] ??= []).push(mutation);
        return query;
      },
      update: () => query,
      single: async () => result(),
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject)
    };
    return query;
  });
});

describe("signup payment amount validation", () => {
  it.each(["Paid", "Sent", "Full season payment", ""])("preserves an explicit player-line amount with note %j", (note) => {
    expect(normalizeImportedPaymentAmountSource({ amount: 195, amountSource: "player_line", note })).toBe("player_line");
  });

  it("continues to reject general prices and absent amounts", () => {
    expect(normalizeImportedPaymentAmountSource({ amount: 195, amountSource: "player_line", note: "Full season cost: $195" })).toBe("general_context");
    expect(normalizeImportedPaymentAmountSource({ amount: 12, amountSource: "general_context", note: "12$ for drop ins" })).toBe("general_context");
    expect(normalizeImportedPaymentAmountSource({ amount: null, note: "Sent" })).toBe("inferred_session_price");
  });

  it("keeps an explicit amount through LLM normalization even when the note is only Sent", () => {
    const parsed = normalizeParsedJson({
      importType: "season_signup",
      payments: [{ playerName: "Jahir", amount: 195, amountSource: "player_line", note: "Sent" }]
    }, rawText);
    expect(parsed.payments[0].amountSource).toBe("player_line");
    expect(parsed.payments[0].amount).toBe(195);
  });
});

describe("Fall signup confirmation", () => {
  it("parses the supplied message as 21 players, 19 payments, and no attendance", async () => {
    const parsed = await new RuleBasedWhatsAppParser().parse(rawText);
    expect(parsed.importType).toBe("season_signup");
    expect(parsed.season?.name).toBe("Fall 2026");
    expect(parsed.players.map((player) => player.name)).toEqual(names);
    expect(parsed.payments).toHaveLength(19);
    expect(parsed.payments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0)).toBe(3633);
    expect(parsed.attendance).toEqual([]);
  });

  it("records all 19 explicit payments and ledgers in Fall despite existing Summer payments", async () => {
    records.payments.push({ id: "summer-payment", season_id: summer, player_id: players[0].id, amount: 195 });
    const result = await confirmWhatsAppImport(null, form());
    expect(result).toMatchObject({ success: true, message: expect.stringContaining("19 payments recorded") });
    const fallPayments = records.payments.filter((payment) => payment.season_id === fall);
    expect(fallPayments).toHaveLength(19);
    expect(fallPayments.reduce((sum, payment) => sum + payment.amount, 0)).toBe(3633);
    expect(fallPayments.every((payment) => payment.session_id === null)).toBe(true);
    expect(records.ledger_entries).toHaveLength(19);
    expect(records.ledger_entries.every((entry) => entry.season_id === fall && entry.type === "payment_received")).toBe(true);
    expect(records.whatsapp_imports[0].parsed_json.players.every((player: any) => player.matchedPlayerId)).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/public/report");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("does not duplicate payments or ledgers when the signup is confirmed again", async () => {
    await confirmWhatsAppImport(null, form());
    const result = await confirmWhatsAppImport(null, form());
    expect(records.payments).toHaveLength(19);
    expect(records.ledger_entries).toHaveLength(19);
    expect(result).toMatchObject({ success: true, message: expect.stringContaining("0 payments recorded, 19 already recorded") });
  });

  it("reports skipped amounts instead of silently reporting success", async () => {
    const data = form();
    const parsed = JSON.parse(String(data.get("parsedJson")));
    parsed.payments[0] = { ...parsed.payments[0], amountSource: "general_context", note: "Full season cost: $195" };
    data.set("parsedJson", JSON.stringify(parsed));
    const result = await confirmWhatsAppImport(null, data);
    expect(result).toMatchObject({ success: true, warning: expect.stringContaining("1 payments skipped") });
    expect(records.payments).toHaveLength(18);
    expect(records.audit_logs).toContainEqual(expect.objectContaining({ action: "payment_import_skipped_no_amount" }));
  });
});
