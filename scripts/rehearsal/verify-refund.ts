import { assertSame, checksums, connect, connections } from './core';

async function main() {
  const { target } = connections();
  if (!process.argv.includes(`--confirm=${target.ref}`)) throw new Error('Confirm development project before rollback-only testing.');
  const db = connect(target.url);
  const rollback = new Error('Expected test rollback');
  try {
    const before = await checksums(q => db.unsafe(q));
    try {
      await db.begin(async tx => {
        await tx`set local lock_timeout='10s'`;
        const owner = (await tx`select profile_id from public.organization_members where role='owner'`)[0];
        const member = (await tx`select profile_id from public.program_members where role='member' and status='active' limit 1`)[0];
        if (!owner || !member) throw new Error('Missing test roles.');
        await tx`select set_config('request.jwt.claim.sub',${owner.profile_id},true),
          set_config('rehearsal.member',${member.profile_id},true)`;
        await tx`set local role authenticated`;
        await tx.unsafe(`do $$
          declare candidate record; submission uuid := gen_random_uuid(); first_id uuid; second_id uuid;
            after_credit numeric; before_dashboard numeric; after_dashboard numeric; denied boolean := false;
          begin
            select player_id,season_id,credit_amount into strict candidate
              from public.player_season_payment_summary where credit_amount >= 0.01 order by player_id limit 1;
            select total_player_credit into before_dashboard from public.admin_dashboard_season_finance(candidate.season_id);
            select public.record_player_refund(candidate.player_id,candidate.season_id,0.01,current_date-1,'other','Rollback-only rehearsal',submission) into first_id;
            select public.record_player_refund(candidate.player_id,candidate.season_id,0.01,current_date-1,'other','Rollback-only rehearsal',submission) into second_id;
            if first_id is distinct from second_id then raise exception 'Duplicate refund was created'; end if;
            select credit_amount into after_credit from public.player_season_payment_summary
              where player_id=candidate.player_id and season_id=candidate.season_id;
            select total_player_credit into after_dashboard from public.admin_dashboard_season_finance(candidate.season_id);
            if after_credit is distinct from candidate.credit_amount-0.01
              or after_dashboard is distinct from before_dashboard-0.01 then raise exception 'Refund totals differ'; end if;
            begin
              perform public.record_player_refund(candidate.player_id,candidate.season_id,candidate.credit_amount+1,current_date-1,'other',null,gen_random_uuid());
            exception when raise_exception then
              if sqlerrm not like 'Refund exceeds current season credit%' then raise; end if;
              denied := true;
            end;
            if not denied then raise exception 'Excess refund accepted'; end if;
            denied := false;
            perform set_config('request.jwt.claim.sub',current_setting('rehearsal.member'),true);
            begin
              perform public.record_player_refund(candidate.player_id,candidate.season_id,0.01,current_date-1,'other',null,gen_random_uuid());
            exception when raise_exception then
              if sqlerrm <> 'Only an authorized program manager can record this refund' then raise; end if;
              denied := true;
            end;
            if not denied then raise exception 'Member refund accepted'; end if;
          end $$;`);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assertSame(await checksums(q => db.unsafe(q)), before, 'Application data after rollback-only refund tests');
    console.log('Refund, duplicate prevention, exact dashboard delta, insufficient-credit and member restrictions passed; all test writes rolled back.');
  } finally {
    await db.end({ timeout: 2 });
  }
}

main().catch(error => {
  console.error(error.code ? `Refund test failed (${error.code}); transaction rolled back.` : error.message);
  process.exitCode = 1;
});
