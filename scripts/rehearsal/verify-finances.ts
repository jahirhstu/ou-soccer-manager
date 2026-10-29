import { assertSame, connect, connections } from './core';

async function inspect(url: string) {
  const db = connect(url, true);
  try {
    return await db.begin('isolation level repeatable read read only', async tx => {
      const owners = await tx`select profile_id from public.organization_members where role='owner'`;
      if (owners.length !== 1) throw new Error('Expected the reviewed sole owner.');
      await tx`select set_config('request.jwt.claim.sub', ${owners[0].profile_id}, true)`;
      const finances = await tx`select s.id, s.name, f.* from public.seasons s
        cross join lateral public.admin_dashboard_season_finance(s.id) f order by s.id`;
      const balances = await tx`select count(*)::text count,
        md5(coalesce(string_agg(md5(to_jsonb(s)::text), '' order by s.player_id,s.season_id),'')) hash
        from public.player_season_payment_summary s`;
      const totals = await tx`select
        (select count(*) from public.players)::text players,
        (select count(*) from public.sessions)::text sessions,
        (select count(*) from public.payments)::text payments,
        (select sum(amount) from public.payments)::text payment_amount,
        (select sum(amount) from public.club_expenses)::text expenses,
        (select sum(amount) from public.ledger_entries where type='refund_paid')::text refunds,
        (select sum(greatest(credit_amount,0)) from public.player_season_payment_summary)::text positive_credit`;
      return { finances: [...finances], balances: [...balances], totals: [...totals] };
    });
  } finally {
    await db.end({ timeout: 2 });
  }
}

async function main() {
  const { source, target } = connections();
  const production = await inspect(source.url);
  const development = await inspect(target.url);
  assertSame(development, production, 'Season finances and every player balance');
  console.log(JSON.stringify({ result: 'match', totals: development.totals, seasons: development.finances }, null, 2));
}

main().catch(error => {
  console.error(error.code ? `Read-only verification failed (${error.code}).` : error.message);
  process.exitCode = 1;
});
