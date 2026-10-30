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

async function performanceFixture(rounds = 1, threeTeams = false) {
  const sessionId = await operationsSession();
  const count = threeTeams ? 3 : 2;
  const players = await q("select id from players where organization_id=(select organization_id from sessions where id=$1) order by id limit 21", [sessionId]);
  const teams: string[] = [];
  for (let i = 0; i < count; i++) {
    const [team] = await q("insert into session_teams(session_id,organization_id,program_id,name,label,captain_player_id) select id,organization_id,program_id,$2,$2,$3 from sessions where id=$1 returning id", [sessionId, `Team ${i}`, players[i * 7].id]);
    teams.push(team.id);
    for (const p of players.slice(i * 7, i * 7 + 7)) await q("insert into session_team_players(session_id,session_team_id,player_id,organization_id,program_id) select id,$2,$3,organization_id,program_id from sessions where id=$1", [sessionId, team.id, p.id]);
  }
  let number = 0;
  const matches: string[] = [];
  for (let r = 0; r < rounds; r++) for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) {
    const [match] = await q("insert into session_matches(session_id,organization_id,program_id,match_number,team_a_id,team_b_id,result_status) select id,organization_id,program_id,$2,$3,$4,'played' from sessions where id=$1 returning id", [sessionId, ++number, teams[a], teams[b]]);
    matches.push(match.id);
    await q("select confirm_match_positions($1,$2)", [match.id, JSON.stringify([a, b].flatMap(t => players.slice(t * 7, t * 7 + 7).map((p, n) => ({ playerId: p.id, participated: true, position: n === 0 ? "goalkeeper" : n < 3 ? "defender" : n < 5 ? "midfielder" : "forward" }))))]);
  }
  return { sessionId, teams, matches, players };
}

for (const count of [1, 2, 4]) it(`normalizes ${count} actual matches to the same session quality rating`, async () => {
  await asUser("owner", async () => {
    const f = await performanceFixture(count);
    const [{ result }] = await q("select session_performance($1) result", [f.sessionId]);
    expect(result.results).toHaveLength(14);
    const keeper = result.results.find((r: any) => r.player_id === f.players[0].id);
    expect(keeper.matches_played).toBe(count);
    expect(keeper.match_points).toBe(28);
    expect(keeper.captain_points).toBe(0);
    expect(result.details.filter((d: any) => d.player_id === f.players[0].id).every((d: any) => d.clean_sheet && d.keeper_conceded === 0)).toBe(true);
  });
});

it("counts four appearances each in a three-team seven-a-side six-match session", async () => {
  await asUser("owner", async () => {
    const f = await performanceFixture(2, true);
    const [{ result }] = await q("select session_performance($1) result", [f.sessionId]);
    expect(result.matches).toHaveLength(6);
    expect(result.results).toHaveLength(21);
    expect(result.results.every((r: any) => r.matches_played === 4 && r.final_rating <= 40)).toBe(true);
  });
});

it("preserves match positions and keeper attribution across atomic score corrections", async () => {
  await asUser("owner", async () => {
    const f = await performanceFixture();
    const games = [{ matchNumber: 1, teamAId: f.teams[0], teamBId: f.teams[1], resultStatus: "played", goals: [{ scorerId: f.players[5].id, assistPlayerId: f.players[3].id, concededGoalkeeperId: f.players[7].id, goalType: "goal", goalCount: 2 }] }];
    await q("select save_program_game_scores($1,$2)", [f.sessionId, JSON.stringify(games)]);
    let result = (await q("select session_performance($1) result", [f.sessionId]))[0].result;
    expect(result.matches[0].id).toBe(f.matches[0]);
    expect(result.details.find((d: any) => d.player_id === f.players[7].id).keeper_conceded).toBe(2);
    expect(result.results.find((d: any) => d.player_id === f.players[5].id).goals).toBe(2);
    const editor = (await q("select mobile_session($1,$2) result", [soccer, f.sessionId]))[0].result;
    expect(editor.matches[0].goals[0].concededGoalkeeperId).toBe(f.players[7].id);
    games[0].goals[0].concededGoalkeeperId = f.players[0].id;
    await db.exec("savepoint invalid_keeper");
    await expect(q("select save_program_game_scores($1,$2)", [f.sessionId, JSON.stringify(games)])).rejects.toThrow("opposing goalkeeper");
    await db.exec("rollback to savepoint invalid_keeper");
    expect((await q("select session_performance($1) result", [f.sessionId]))[0].result.results).toEqual(result.results);
    games[0].goals = [];
    await q("select save_program_game_scores($1,$2)", [f.sessionId, JSON.stringify(games)]);
    result = (await q("select session_performance($1) result", [f.sessionId]))[0].result;
    expect(result.details.find((d: any) => d.player_id === f.players[7].id).clean_sheet).toBe(true);
    expect(result.positions).toHaveLength(14);
  });
});

it("does not invent historical keeper attribution or positions; counts partial participation", async () => {
  await asUser("owner", async () => {
    const f = await performanceFixture(2);
    await q("update session_matches set team_a_score=3 where id=$1", [f.matches[0]]);
    await q("select confirm_match_positions($1,$2)", [f.matches[1], JSON.stringify([{ playerId: f.players[7].id, position: "", participated: false }, { playerId: f.players[0].id, position: "", participated: true }])]);
    const result = (await q("select session_performance($1) result", [f.sessionId]))[0].result;
    const keeper = result.details.find((d: any) => d.player_id === f.players[7].id);
    expect(keeper.keeper_conceded).toBeNull();
    expect(keeper.clean_sheet).toBe(false);
    expect(result.results.find((d: any) => d.player_id === f.players[7].id).matches_played).toBe(1);
    const unknown = result.results.find((d: any) => d.player_id === f.players[0].id);
    expect(unknown.rated_matches).toBe(1);
    expect(unknown.incomplete).toBe(true);
  });
});

it("caps ratings and applies position-specific clean-sheet weights", async () => {
  for (const [position, clean] of [["goalkeeper", 7], ["defender", 6], ["midfielder", 4], ["forward", 3]] as const) {
    expect((await q("select match_performance_points_v1($1,0,0,0,0,0) r", [position]))[0].r.rating).toBe(clean);
    const high = (await q("select match_performance_points_v1($1,99,0,99,99,0) r", [position]))[0].r;
    expect(high.rating).toBeLessThanOrEqual(10);
    expect(high.individual).toBe(4);
  }
});

it("supports captain edits, ties, 30/60 points, closed ballots and correction-driven eligibility", async () => {
  await asUser("owner", async () => {
    const f = await performanceFixture(1, true);
    await q("update sessions set status='completed' where id=$1", [f.sessionId]);
    await db.exec("reset role");
    await q("delete from program_members where program_id=$1 and profile_id is null", [soccer]);
    await q("update program_members set player_id=null where program_id=$1", [soccer]);
    await db.exec("set local role authenticated");
    // The owner account is explicitly linked to the captain of each team in turn.
    const link = async (team: number) => {
      await db.exec("reset role");
      await q("update program_members set player_id=$2 where profile_id=$1 and program_id=$3", [ids.owner, f.players[team * 7].id, soccer]);
      await db.exec("set local role authenticated");
    };
    await link(0);
    await q("select nominate_session_player($1,$2,'goalkeeper',$3)", [f.sessionId, f.teams[0], f.players[7].id]);
    await q("select nominate_session_player($1,$2,'goalkeeper',$3)", [f.sessionId, f.teams[0], f.players[7].id]);
    let result = (await q("select session_performance($1) result", [f.sessionId]))[0].result;
    expect(result.votes).toHaveLength(1);
    expect(result.results.find((r: any) => r.player_id === f.players[7].id).captain_points).toBe(30);
    await q("select close_performance_voting($1,true)", [f.sessionId]);
    await db.exec("savepoint closed_vote");
    await expect(q("select nominate_session_player($1,$2,'goalkeeper',$3)", [f.sessionId, f.teams[0], f.players[14].id])).rejects.toThrow("closed");
    await db.exec("rollback to savepoint closed_vote");
    await q("select close_performance_voting($1,false)", [f.sessionId]);
    await q("select nominate_session_player($1,$2,'goalkeeper',$3)", [f.sessionId, f.teams[0], f.players[14].id]);
    result = (await q("select session_performance($1) result", [f.sessionId]))[0].result;
    expect(result.results.find((r: any) => r.player_id === f.players[7].id).captain_points).toBe(0);
    expect(result.results.find((r: any) => r.player_id === f.players[14].id).captain_points).toBe(30);
    await db.exec("savepoint own_vote");
    await expect(q("select nominate_session_player($1,$2,'goalkeeper',$3)", [f.sessionId, f.teams[0], f.players[0].id])).rejects.toThrow("another team");
    await db.exec("rollback to savepoint own_vote");
    // Retain distinct captain accounts for simultaneous valid ballots.
    await db.exec("reset role");
    await q("update program_members set player_id=$2 where profile_id=$1 and program_id=$3", [ids.captain, f.players[7].id, soccer]);
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.captain]);
    await db.exec("set local role authenticated");
    await q("select nominate_session_player($1,$2,'goalkeeper',$3)", [f.sessionId, f.teams[1], f.players[14].id]);
    result = (await q("select session_performance($1) result", [f.sessionId]))[0].result;
    expect(result.results.find((r: any) => r.player_id === f.players[14].id).captain_points).toBe(60);
    await q("select nominate_session_player($1,$2,'goalkeeper',$3)", [f.sessionId, f.teams[1], f.players[0].id]);
    result = (await q("select session_performance($1) result", [f.sessionId]))[0].result;
    expect(result.awards).toHaveLength(2);
    for (const m of result.matches.filter((m: any) => [m.teamAId, m.teamBId].includes(f.teams[2]))) await q("select confirm_match_positions($1,$2)", [m.id, JSON.stringify([{ playerId: f.players[14].id, position: "forward", participated: true }])]);
    result = (await q("select session_performance($1) result", [f.sessionId]))[0].result;
    expect(result.results.find((r: any) => r.player_id === f.players[14].id).captain_points).toBe(0);
    expect(result.awards).toHaveLength(1);
    const ranks = (await q("select season_performance($1) result", [season]))[0].result;
    expect(ranks.find((r: any) => r.player_id === f.players[0].id && r.position === "goalkeeper").average_session_rating).toBe(58);
    expect(ranks.find((r: any) => r.player_id === f.players[14].id && r.position === "forward").nominations).toBe(0);
  });
});

it("rejects member edits, forged captain ballots, cross-organization reads and anonymous access", async () => {
  await asUser("owner", async () => {
    const f = await performanceFixture();
    await q("update sessions set status='completed' where id=$1", [f.sessionId]);
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.member]);
    for (const [sql, args, message] of [
      ["select confirm_match_positions($1,$2)", [f.matches[0], JSON.stringify([{ playerId: f.players[0].id, position: "forward", participated: true }])], "Score management"],
      ["select nominate_session_player($1,$2,'goalkeeper',$3)", [f.sessionId, f.teams[0], f.players[7].id], "Only this team captain"],
      ["select close_performance_voting($1,true)", [f.sessionId], "Manager access"],
      ["insert into captain_performance_votes(session_id,captain_team_id,category,player_id,voter_id) values($1,$2,'goalkeeper',$3,$4)", [f.sessionId, f.teams[0], f.players[7].id, ids.member], "permission denied"],
    ] as const) {
      await db.exec("savepoint denied");
      await expect(q(sql, [...args])).rejects.toThrow(message);
      await db.exec("rollback to savepoint denied");
    }
    await q("select set_config('request.jwt.claim.sub',$1,true)", [ids.outsider]);
    await db.exec("savepoint outsider");
    await expect(q("select session_performance($1)", [f.sessionId])).rejects.toThrow("Program access");
    await db.exec("rollback to savepoint outsider");
    await db.exec("set local role anon");
    await expect(q("select session_performance($1)", [f.sessionId])).rejects.toThrow("permission denied");
  });
});

it("handles an empty pooled authorization context when renaming and assigning teams", async () => {
  await asUser("owner", async () => {
    const sessionId = await operationsSession();
    await q("select set_config('app.authorized_program_id','',true)");
    await q("select organization_role(organization_id) from sessions where id=$1", [sessionId]);
    const teams = [{ id: "", name: "Team Sadat", captainPlayerId: "", playerIds: [player] },
      { id: "", name: "Team 2", captainPlayerId: "", playerIds: [] }];
    await q("select save_program_team_builder_draft($1,$2,7,'manual',0,'[]',0)", [sessionId, JSON.stringify(teams)]);
    await q("select save_program_team_builder($1,$2,7)", [sessionId, JSON.stringify(teams)]);
    const saved = await q("select id,name from session_teams where session_id=$1 order by name", [sessionId]);
    expect(saved.map((t) => t.name)).toEqual(["Team 2", "Team Sadat"]);
    expect((await q("select session_team_id from session_team_players where session_id=$1 and player_id=$2", [sessionId, player]))[0].session_team_id).toBe(saved[1].id);
    await q("select set_config('app.authorized_program_id','',true)");
    await q("select save_program_team_builder($1,$2,7)", [sessionId, JSON.stringify([
      { ...teams[0], id: saved[1].id, name: "Team Renamed", playerIds: [] },
      { ...teams[1], id: saved[0].id, playerIds: [player] },
    ])]);
    expect((await q("select session_team_id from session_team_players where session_id=$1 and player_id=$2", [sessionId, player]))[0].session_team_id).toBe(saved[0].id);
    expect((await q("select name from session_teams where id=$1", [saved[1].id]))[0].name).toBe("Team Renamed");
  });
});

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
