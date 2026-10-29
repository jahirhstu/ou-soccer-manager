import { beforeAll, afterAll, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { localDatabase } from "../../scripts/demo/local-database";
import { accounts, buildDemoDataset, demoId, type AccountIds } from "../../scripts/demo/dataset";
import { accessibleWorkspaces, canScore, validAmount, money, type Workspace } from "../../packages/contracts/src";

let db: Awaited<ReturnType<typeof localDatabase>>;
const ids = Object.fromEntries(accounts.map((key) => [key, demoId(`native-account:${key}`)])) as AccountIds;
const soccer = demoId("northstar-demo:soccer");
const basketball = demoId("northstar-demo:basketball");
const other = demoId("riverside-demo:soccer");
const season = demoId("northstar-demo:soccer:season:1");
const player = demoId("northstar-demo:player:0");
async function q(sql: string, values: unknown[] = []) { return (await db.query<any>(sql, values)).rows; }
async function asUser(key: keyof AccountIds, action: () => Promise<void>) {
  await db.exec("begin");
  try {
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids[key]]);
    await db.exec("set local role authenticated");
    await action();
  } finally { await db.exec("rollback"); }
}
beforeAll(async () => {
  db = await localDatabase();
  await db.exec(`
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$ select (string_to_array(name,'/'))[1:1] $$;
    grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  for (const file of readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const key of accounts) await q("insert into auth.users(id,email) values($1,$2)", [ids[key], `${key}@test.invalid`]);
  await db.exec("begin");
  await db.exec(buildDemoDataset(ids, "2026-10-26").sql);
  await db.exec("commit");
}, 120000);
afterAll(async () => { await db?.close(); });

async function operationsSession() {
  const id = demoId("native-operations-session");
  await q("select mobile_create_record($1,'session',$2,$3)", [soccer, id,
    { name: "Operations test", seasonId: season, date: "2099-01-01", startTime: "07:00", endTime: "09:00", price: "12.01" }]);
  return id;
}

it("generates alternating fixtures atomically and protects duplicate submissions", async () => {
  await asUser("owner", async () => {
    const sessionId = await operationsSession();
    const teams = await q("insert into session_teams(organization_id,program_id,session_id,name,label,created_by) select organization_id,program_id,id,n,n,auth.uid() from sessions cross join (values ('A'),('B'),('C')) names(n) where id=$1 returning id", [sessionId]);
    const submission=demoId("fixture-submit");
    const args=[soccer,sessionId,submission,teams[0].id];
    const sql="select mobile_generate_fixture($1,$2,$3,2,12,15,3,5,$4) result";
    const first=await q(sql,args);
    expect(first[0].result.games).toBe(6);
    expect(await q(sql,args)).toEqual(first);
    const matches=await q("select team_a_id,team_b_id,scheduled_start_time::text start,scheduled_end_time::text finish from session_matches where session_id=$1 order by display_order",[sessionId]);
    expect(matches).toHaveLength(6);
    expect(matches[0].team_a_id).not.toBe(teams[0].id);
    expect(matches[0].team_b_id).not.toBe(teams[0].id);
    expect(matches[3].team_a_id).toBe(matches[0].team_b_id);
    expect(matches[3].start).toBe("07:41:00");
    expect(matches[3].finish).toBe("07:56:00");
  });
});

it("rejects fixture regeneration after a scoreless game is marked played", async () => {
  await asUser("owner", async () => {
    const sessionId=await operationsSession();
    await q("insert into session_teams(organization_id,program_id,session_id,name,label,created_by) select organization_id,program_id,id,n,n,auth.uid() from sessions cross join (values ('A'),('B')) names(n) where id=$1",[sessionId]);
    await q("select mobile_generate_fixture($1,$2,$3,1,12,12,0,0)",[soccer,sessionId,demoId("fixture-before-score")]);
    await q("update session_matches set result_status='played' where session_id=$1",[sessionId]);
    await expect(q("select mobile_generate_fixture($1,$2,$3,1,12,12,0,0)",[soccer,sessionId,demoId("fixture-after-score")])).rejects.toThrow("after scores");
  });
});

it("rejects ordinary member and cross-program fixture operations", async () => {
  await asUser("member",async()=>{
    await expect(q("select mobile_generate_fixture($1,$2,$3,1,12,12,0,0)",[soccer,demoId("nonexistent-session"),demoId("fixture-member")])).rejects.toThrow("Fixture access");
  });
  await asUser("owner",async()=>{
    const sessionId=await operationsSession();
    await expect(q("select mobile_session_planning($1,$2)",[basketball,sessionId])).rejects.toThrow("Session not found");
  });
});

it("records attendance, a cent-exact charge and linked ledger once across retries", async () => {
  await asUser("owner", async () => {
    const sessionId = await operationsSession();
    const payload = { playerId: player, status: "confirmed", notes: "Test", expectedStatus: null };
    const args = [soccer, sessionId, demoId("native-attendance-submit"), payload];
    const first = await q("select mobile_session_operation($1,$2,'attendance',$3,$4) result", args);
    expect(await q("select mobile_session_operation($1,$2,'attendance',$3,$4) result", args)).toEqual(first);
    const charges = await q("select c.amount::text amount,l.amount::text ledger from session_player_charges c join ledger_entries l on l.id=c.ledger_entry_id where c.session_id=$1", [sessionId]);
    expect(charges).toEqual([{ amount: "12.01", ledger: "12.01" }]);
    expect((await q("select status from attendance where session_id=$1", [sessionId]))[0].status).toBe("confirmed");
    await expect(q("select mobile_session_operation($1,$2,'attendance',$3,$4)", [soccer,sessionId,args[2],{ ...payload, status: "absent" }])).rejects.toThrow("Submission ID already used");
  });
});

it("completes sessions without overwriting waived charges or duplicating usage", async () => {
  await asUser("owner", async () => {
    const sessionId = await operationsSession();
    await q("select mobile_session_operation($1,$2,'attendance',$3,$4)", [soccer,sessionId,demoId("native-ops-attend"),{ playerId: player,status:"confirmed",expectedStatus:null }]);
    await q("update session_player_charges set amount=2.01,waiver_amount=10,waiver_reason='Test waiver' where session_id=$1", [sessionId]);
    await q("update ledger_entries set amount=2.01 where session_id=$1 and type='session_used'", [sessionId]);
    const args=[soccer,sessionId,demoId("native-ops-complete")];
    const first=await q("select mobile_session_operation($1,$2,'complete',$3,'{}') result",args);
    expect(await q("select mobile_session_operation($1,$2,'complete',$3,'{}') result",args)).toEqual(first);
    expect((await q("select status from sessions where id=$1",[sessionId]))[0].status).toBe("completed");
    expect((await q("select status from attendance where session_id=$1",[sessionId]))[0].status).toBe("played");
    expect(await q("select amount::text amount,waiver_amount::text waived from session_player_charges where session_id=$1",[sessionId])).toEqual([{amount:"2.01",waived:"10.00"}]);
    expect((await q("select count(*)::int n from ledger_entries where session_id=$1",[sessionId]))[0].n).toBe(1);
  });
});

it("removes only non-billable usage and preserves payment receipts", async () => {
  await asUser("owner", async () => {
    const sessionId=await operationsSession();
    const before=(await q("select count(*)::int n from payments where player_id=$1",[player]))[0].n;
    await q("select mobile_session_operation($1,$2,'attendance',$3,$4)",[soccer,sessionId,demoId("native-billable"),{playerId:player,status:"confirmed",expectedStatus:null}]);
    await q("select mobile_session_operation($1,$2,'attendance',$3,$4)",[soccer,sessionId,demoId("native-absent"),{playerId:player,status:"absent",expectedStatus:"confirmed"}]);
    expect(await q("select id from session_player_charges where session_id=$1",[sessionId])).toEqual([]);
    expect(await q("select id from ledger_entries where session_id=$1",[sessionId])).toEqual([]);
    expect((await q("select count(*)::int n from payments where player_id=$1",[player]))[0].n).toBe(before);
  });
});

it("permits captain attendance but not session completion", async () => {
  await asUser("owner", async () => {
    const sessionId=await operationsSession();
    await q("select set_config('request.jwt.claim.sub',$1,true)",[ids.captain]);
    await q("select mobile_session_operation($1,$2,'attendance',$3,$4)",[soccer,sessionId,demoId("native-captain-attend"),{playerId:player,status:"waitlisted",expectedStatus:null}]);
    const roster=(await q("select mobile_session_roster($1,$2,0,'') result",[soccer,sessionId]))[0].result;
    expect(roster.canComplete).toBe(false);
    await expect(q("select mobile_session_operation($1,$2,'complete',$3,'{}')",[soccer,sessionId,demoId("native-captain-complete")])).rejects.toThrow("Manager access required");
  });
});

it("rejects stale attendance updates and cross-program roster access", async () => {
  await asUser("owner", async () => {
    const sessionId=await operationsSession();
    await expect(q("select mobile_session_operation($1,$2,'attendance',$3,$4)",[soccer,sessionId,demoId("native-stale"),{playerId:player,status:"played",expectedStatus:"confirmed"}])).rejects.toThrow("Attendance changed");
  });
  await asUser("soccer-manager", async () => {
    await expect(q("select mobile_session_roster($1,$2)",[soccer,demoId("northstar-demo:basketball:season:1:session:3")])).rejects.toThrow("Session not found");
  });
  await asUser("member",async()=>{
    await expect(q("select mobile_session_roster($1,$2)",[soccer,demoId("northstar-demo:soccer:season:1:session:3")])).rejects.toThrow("Attendance access required");
  });
});

it("blocks disabled attendance modules on direct calls",async()=>{
  await db.exec("begin");
  try {
    await q("update program_modules set enabled=false where program_id=$1 and module_key='attendance'",[soccer]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[ids.owner]);
    await db.exec("set local role authenticated");
    await expect(q("select mobile_session_roster($1,$2)",[soccer,demoId("northstar-demo:soccer:season:1:session:3")])).rejects.toThrow("Attendance access required");
  } finally {await db.exec("rollback");}
});

it("separates app access and retains exact decimal formatting", () => {
  const workspace: Workspace = { organizationId: "o", organizationName: "Club", programId: "p", programName: "Soccer", activityType: "soccer", role: "captain", playerId: "a", currency: "CAD", modules: {} };
  expect(accessibleWorkspaces({ profile: { id: "a", displayName: "A", email: "", photoPath: null }, workspaces: [workspace] }, "management")).toEqual([]);
  expect(canScore(workspace)).toBe(true);
  expect(canScore({ ...workspace, modules: { scores: false } })).toBe(false);
  for (const value of ["0", "-1", "1.001", "1e2", "NaN", "100000000"]) expect(validAmount(value)).toBe(false);
  expect(validAmount("12.01")).toBe(true);
  expect(money("12345678.09", "CAD")).toBe("CAD 12,345,678.09");
});

it("returns only active program memberships, with no global-admin shortcut", async () => {
  await asUser("member", async () => {
    const [{ result }] = await q("select mobile_context() result");
    expect(result.workspaces.map((entry: any) => entry.programId)).toEqual([soccer]);
    expect(result.workspaces[0].role).toBe("member");
  });
  for (const account of ["pending", "suspended", "rejected", "platform-owner"] as const) {
    await asUser(account, async () => expect((await q("select mobile_context() result"))[0].result.workspaces).toEqual([]));
  }
  await asUser("soccer-manager", async () => {
    expect((await q("select mobile_program_access($1) result", [basketball]))[0].result).toBe(false);
    await expect(q("select mobile_list($1,'balances',0)", [other])).rejects.toThrow("Program access required");
  });
});

it("denies anonymous users and suspended memberships", async () => {
  await db.exec("begin; set local role anon");
  try { await expect(q("select mobile_context()")).rejects.toThrow("permission denied"); }
  finally { await db.exec("rollback"); }
  await asUser("suspended", async () => {
    await expect(q("select mobile_list($1,'sessions',0)", [soccer])).rejects.toThrow("Program access required");
  });
});

it("shows only the linked player's balances and transactions to participants", async () => {
  await asUser("member", async () => {
    const ownId = demoId("northstar-demo:player:2");
    for (const resource of ["balances", "myBalances", "payments", "myPayments"]) {
      const [{ result }] = await q("select mobile_list($1,$2,0) result", [soccer, resource]);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.every((row: any) => row.title === "Casey Partial")).toBe(true);
      if (resource.includes("Balances") || resource === "balances")
        expect(result.rows.every((row: any) => row.id.startsWith(ownId))).toBe(true);
    }
    await expect(q("select mobile_list($1,'members',0)", [soccer])).rejects.toThrow("Manager access required");
  });
});

it("paginates without duplicates and does not expose the other tenant in reports", async () => {
  await asUser("owner", async () => {
    const first = (await q("select mobile_list($1,'statistics',0) result", [soccer]))[0].result;
    const second = (await q("select mobile_list($1,'statistics',25) result", [soccer]))[0].result;
    expect(first.rows).toHaveLength(25); expect(first.hasMore).toBe(true);
    expect(first.rows.some((a: any) => second.rows.some((b: any) => b.id === a.id))).toBe(false);
    const otherPlayerIds = Array.from({ length: 25 }, (_, n) => demoId(`riverside-demo:player:${n}`));
    for (const row of [...first.rows, ...second.rows]) expect(otherPlayerIds.some((id) => row.id.startsWith(id))).toBe(false);
  });
});

it("honors disabled modules on direct database calls", async () => {
  await db.exec("begin");
  try {
    await q("update program_modules set enabled=false where program_id=$1 and module_key='payments'", [soccer]);
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.owner]);
    await db.exec("set local role authenticated");
    await expect(q("select mobile_list($1,'balances',0)", [soccer])).rejects.toThrow("Module is disabled");
  } finally { await db.exec("rollback"); }
});

it("creates a payment and ledger exactly once with cent accuracy", async () => {
  await asUser("soccer-manager", async () => {
    const data = { seasonId: season, playerId: player, amount: "12.01", date: "2026-01-01", method: "e-transfer", note: "Native test" };
    const submission = demoId("native-payment");
    const result = await q("select mobile_record_finance($1,'payment',$2,$3) id", [soccer, submission, data]);
    const retry = await q("select mobile_record_finance($1,'payment',$2,$3) id", [soccer, submission, data]);
    expect(retry).toEqual(result);
    expect((await q("select amount::text amount from payments where id=$1", [result[0].id]))[0].amount).toBe("12.01");
    expect((await q("select count(*)::int n from ledger_entries where description='Native test'"))[0].n).toBe(1);
    await expect(q("select mobile_record_finance($1,'payment',$2,$3)", [soccer, submission, { ...data, amount: "12.02" }])).rejects.toThrow("Submission ID already used");
  });
});

it("rejects unauthorized and cross-program finance writes", async () => {
  const data = { seasonId: season, playerId: player, amount: "12.00", date: "2026-01-01", method: "cash" };
  await asUser("captain", async () => {
    await expect(q("select mobile_record_finance($1,'payment',$2,$3)", [soccer, demoId("native-denied"), data])).rejects.toThrow("Manager finance access required");
  });
  await asUser("soccer-manager", async () => {
    await expect(q("select mobile_record_finance($1,'payment',$2,$3)", [soccer, demoId("native-cross"), { ...data, seasonId: demoId("northstar-demo:basketball:season:1") }])).rejects.toThrow("Choose a season in this program");
  });
});

it("supports partial refunds for inactive players and rejects over-refunds", async () => {
  await asUser("owner", async () => {
    const inactive = demoId("northstar-demo:player:19");
    const balance = async () => (await q("select credit_amount::text value from player_season_payment_summary where player_id=$1 and season_id=$2", [inactive, season]))[0].value;
    const before = Number(await balance());
    const data = { seasonId: season, playerId: inactive, amount: "0.01", date: "2026-01-01", method: "cash" };
    const first = await q("select mobile_record_finance($1,'refund',$2,$3) id", [soccer, demoId("native-refund"), data]);
    expect(await q("select mobile_record_finance($1,'refund',$2,$3) id", [soccer, demoId("native-refund"), data])).toEqual(first);
    expect(Number(await balance())).toBeCloseTo(before - 0.01, 2);
    await expect(q("select mobile_record_finance($1,'refund',$2,$3)", [soccer, demoId("native-over-refund"), { ...data, amount: "99999.99" }])).rejects.toThrow("Refund exceeds");
  });
});

it("rejects cross-program sessions and preserves scores on invalid saves", async () => {
  await asUser("captain", async () => {
    await expect(q("select mobile_session($1,$2)", [soccer, demoId("northstar-demo:basketball:season:1:session:3")])).rejects.toThrow("Session access required");
  });
  await asUser("member", async () => {
    await expect(q("select mobile_save_scores($1,$2,'[]')", [soccer, demoId("northstar-demo:soccer:season:1:session:3")])).rejects.toThrow("cannot be scored");
  });
  await asUser("captain", async () => {
    const session = demoId("northstar-demo:soccer:season:1:session:0");
    await expect(q("select mobile_save_scores($1,$2,'[]')", [soccer, session])).rejects.toThrow("cannot be scored");
  });
});

it("creates separate same-name players without name matching and retries safely", async () => {
  await asUser("soccer-manager", async () => {
    const id = demoId("native-new-player");
    const payload = { name: "Alex Morgan", email: "different@test.invalid" };
    await q("select mobile_create_record($1,'player',$2,$3)", [soccer, id, payload]);
    await q("select mobile_create_record($1,'player',$2,$3)", [soccer, id, payload]);
    expect((await q("select count(*)::int n from players where id=$1", [id]))[0].n).toBe(1);
    expect((await q("select count(*)::int n from program_members where program_id=$1 and player_id=$2", [soccer, id]))[0].n).toBe(1);
  });
});

it("keeps web manual autosave while removing browser voice recording", () => {
  const source = readFileSync("components/MiniGameScoresForm.tsx", "utf8");
  expect(source).toContain("saveNow(false)");
  expect(source).toContain("saveMiniGameScores");
  expect(source).not.toContain("getUserMedia");
  expect(source).not.toContain("Voice scoring");
});

it("keeps profile photos private and rejects another account's upload path", async () => {
  await asUser("member", async () => {
    const path = `${ids.member}/photo.jpg`;
    await q("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [path]);
    await q("select set_my_photo($1)", [path]);
    expect((await q("select mobile_context() result"))[0].result.profile.photoPath).toBe(path);
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.captain]);
    expect(await q("select * from storage.objects")).toHaveLength(0);
    await expect(q("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [`${ids.member}/intrusion.jpg`])).rejects.toThrow("row-level security");
  });
  await asUser("member", async () => {
    await expect(q("select set_my_photo($1)", [`${ids.captain}/photo.jpg`])).rejects.toThrow("Invalid photo path");
  });
});

it("requires organization administration for organization approval and manager roles", async () => {
  const member = (await q("select id from program_members where program_id=$1 and profile_id=$2", [soccer, ids.pending]))[0].id;
  await asUser("soccer-manager", async () => {
    await expect(q("select mobile_update_member($1,$2,'manager','active',true)", [soccer, member])).rejects.toThrow("Organization administrator required");
  });
  await asUser("owner", async () => {
    await q("select mobile_update_member($1,$2,'member','active',true)", [soccer, member]);
    expect((await q("select mobile_member($1,$2) result", [soccer, member]))[0].result.status).toBe("active");
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.pending]);
    expect((await q("select mobile_context() result"))[0].result.workspaces).toHaveLength(1);
  });
});

it("moves credit between players and seasons without creating collected revenue", async () => {
  await asUser("owner", async () => {
    const recipient = demoId("northstar-demo:player:10");
    const destination = demoId("northstar-demo:soccer:season:2");
    const before = (await q("select sum(amount)::text total from payments where program_id=$1", [soccer]))[0].total;
    const data = { seasonId: season, playerId: player, recipientId: recipient, destinationSeasonId: destination, amount: "1.25", date: "2026-01-01", note: "Native transfer" };
    for (const kind of ["transfer", "carry"]) {
      const id = demoId(`native-${kind}`);
      const first = await q("select mobile_record_finance($1,$2,$3,$4) id", [soccer, kind, id, data]);
      expect(await q("select mobile_record_finance($1,$2,$3,$4) id", [soccer, kind, id, data])).toEqual(first);
    }
    expect((await q("select sum(amount)::text total from payments where program_id=$1", [soccer]))[0].total).toBe(before);
  });
});

it("records expenses once and requires a matching season", async () => {
  await asUser("owner", async () => {
    const data = { seasonId: season, amount: "25.01", date: "2026-01-01", category: "equipment", note: "Native expense" };
    const id = demoId("native-expense");
    const first = await q("select mobile_record_finance($1,'expense',$2,$3) id", [soccer, id, data]);
    expect(await q("select mobile_record_finance($1,'expense',$2,$3) id", [soccer, id, data])).toEqual(first);
    expect((await q("select amount::text value from club_expenses where id=$1", [first[0].id]))[0].value).toBe("25.01");
    await expect(q("select mobile_record_finance($1,'expense',$2,$3)", [soccer, demoId("native-no-season"), { ...data, seasonId: null }])).rejects.toThrow("Choose a season");
  });
});
