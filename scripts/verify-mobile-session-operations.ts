import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import postgres from "postgres";

// Development-only smoke test. Even successful test writes are rolled back.
async function main() {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  if (!env.DATABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Missing development connection configuration");
  const ref = "vnmloamscqaqmagimfmz";
  const url = new URL(env.DATABASE_URL);
  if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${ref}.supabase.co` ||
    (url.hostname !== `db.${ref}.supabase.co` && decodeURIComponent(url.username) !== `postgres.${ref}`)) throw new Error("Development target mismatch");
  const sql = postgres(env.DATABASE_URL, { ssl: "require", max: 1, prepare: false, connect_timeout: 15 });
  const session = randomUUID(), attendance = randomUUID(), completion = randomUUID();
  let verified = false;
  try {
    try {
      await sql.begin(async (tx) => {
        await tx`set local statement_timeout='30s'`;
        const [scope] = await tx`
          select p.id as program,s.id as season,om.profile_id as actor,pm.player_id as player
          from public.programs p join public.organizations o on o.id=p.organization_id
          join public.organization_members om on om.organization_id=o.id and om.status='active' and om.role in ('owner','admin')
          join public.seasons s on s.program_id=p.id
          join public.program_members pm on pm.program_id=p.id and pm.player_id is not null
          where p.status='active' and o.onboarding_status='active'
            and public.is_program_module_enabled(p.id,'activities') and public.is_program_module_enabled(p.id,'attendance') limit 1`;
        if (!scope) throw new Error("No suitable development test scope");
        await tx`select set_config('request.jwt.claim.sub',${scope.actor},true)`;
        await tx`set local role authenticated`;
        const sessionData = { name: "Rollback-only native smoke test", seasonId: scope.season, date: "2099-01-01", startTime: "07:00", endTime: "09:00", price: "12.01" };
        await tx`select public.mobile_create_record(${scope.program},'session',${session},${tx.json(sessionData)})`;
        const data = { playerId: scope.player, status: "confirmed", expectedStatus: null };
        await tx`select public.mobile_session_operation(${scope.program},${session},'attendance',${attendance},${tx.json(data)})`;
        await tx`select public.mobile_session_operation(${scope.program},${session},'attendance',${attendance},${tx.json(data)})`;
        await tx`select public.mobile_session_operation(${scope.program},${session},'complete',${completion},'{}')`;
        const charges = await tx`select c.amount::text as amount,l.amount::text as ledger,a.status
          from public.session_player_charges c join public.ledger_entries l on l.id=c.ledger_entry_id
          join public.attendance a on a.session_id=c.session_id and a.player_id=c.player_id where c.session_id=${session}`;
        if (charges.length !== 1 || charges[0].amount !== "12.01" || charges[0].ledger !== "12.01" || charges[0].status !== "played") throw new Error("Charge or attendance verification failed");
        const [result] = await tx`select public.mobile_session_roster(${scope.program},${session},0,'') as roster`;
        if (result.roster.session.status !== "completed") throw new Error("Session completion verification failed");
        verified = true;
        throw new Error("ROLLBACK_SMOKE_TEST");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ROLLBACK_SMOKE_TEST") throw error;
    }
    const [remaining] = await sql`select (select count(*) from public.sessions where id=${session}) +
      (select count(*) from public.audit_logs where id in (${session},${attendance},${completion})) as n`;
    if (!verified || Number(remaining.n) !== 0) throw new Error("Rollback verification failed");
    console.log(JSON.stringify({ development: true, attendance: "passed", duplicateRetry: "passed", completion: "passed", exactCharge: "12.01", testWritesRolledBack: true }));
  } finally { await sql.end({ timeout: 2 }); }
}
main().catch((error) => { console.error("Mobile smoke test failed:", error instanceof Error ? error.message : "Unknown error"); process.exitCode = 1; });
