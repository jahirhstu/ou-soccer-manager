-- Cash movement only: ledger payment mirrors and non-cash player adjustments are excluded.
create or replace function public.admin_club_cash_report(
  p_program_id uuid, p_from date, p_to date, p_season_id uuid default null,
  p_page integer default 1, p_page_size integer default 25
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_result jsonb;
begin
  select organization_id into v_org from public.programs where id = p_program_id;
  if v_org is null or public.can_manage_program_finance(p_program_id) is not true then
    raise exception 'Only an authorized program manager can view cash reports';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Enter a valid From and To date'; end if;
  if p_season_id is not null and not exists(select 1 from public.seasons where id=p_season_id
    and program_id=p_program_id and organization_id=v_org) then raise exception 'Season does not belong to this program'; end if;
  if p_page is null or p_page < 1 or (p_page_size is not null and p_page_size not in (10,25,50)) then raise exception 'Invalid pagination'; end if;
  with movements as (
    select p.id, 'payment'::text source, p.payment_date transaction_date, p.created_at,
      case when p.amount < 0 then 'Payment adjustment — ' else 'Payment received — ' end || coalesce(x.display_name,'Player') particulars,
      coalesce(p.reference_note,'') description, s.name season, p.amount delta
    from public.payments p join public.seasons s on s.id=p.season_id left join public.players x on x.id=p.player_id
    where s.program_id=p_program_id and p.organization_id=v_org and p.amount<>0 and (p_season_id is null or s.id=p_season_id)
    union all
    select e.id,'expense',e.expense_date,e.created_at,'Expense — ' || coalesce(nullif(e.vendor,''),e.category),
      concat_ws(' · ',e.category,e.notes,case when e.season_id is null then 'Unassigned expense' end),coalesce(s.name,'Unassigned'),-e.amount
    from public.club_expenses e left join public.seasons s on s.id=e.season_id
    where e.organization_id=v_org and e.program_id=p_program_id
      and (p_season_id is null or e.season_id=p_season_id or e.season_id is null)
    union all
    select l.id,'refund',coalesce(l.refund_date,(l.created_at at time zone 'America/Toronto')::date),l.created_at,
      'Refund — ' || coalesce(x.display_name,'Player'),concat_ws(' · ',l.description,
        case when l.refund_date is null then 'Date based on recorded creation date' end),s.name,-l.amount
    from public.ledger_entries l join public.seasons s on s.id=l.season_id left join public.players x on x.id=l.player_id
    where l.organization_id=v_org and s.program_id=p_program_id and l.type='refund_paid'
      and (p_season_id is null or s.id=p_season_id)
    union all
    select t.id,'transfer',t.transfer_date,t.created_at,
      case when t.reverses_transfer_id is not null then 'Transfer reversal' else 'Season transfer' end,
      concat_ws(' · ',src.name || ' → ' || dst.name,t.note),
      case when t.destination_season_id=p_season_id then dst.name else src.name end,
      case when t.destination_season_id=p_season_id then t.amount else -t.amount end
    from public.club_balance_transfers t join public.seasons src on src.id=t.source_season_id
    join public.seasons dst on dst.id=t.destination_season_id
    where t.organization_id=v_org and t.program_id=p_program_id and p_season_id is not null
      and p_season_id in (t.source_season_id,t.destination_season_id)
  ), opening as (
    select coalesce(sum(delta),0) amount from movements where transaction_date<p_from
  ), period as (
    select *,row_number() over(order by transaction_date,created_at nulls first,source,id) number,
      (select amount from opening)+sum(delta) over(order by transaction_date,created_at nulls first,source,id rows unbounded preceding) balance
    from movements where transaction_date between p_from and p_to
  ), totals as (
    select count(*) count,coalesce(sum(greatest(delta,0)),0) money_in,coalesce(sum(greatest(-delta,0)),0) money_out from period
  ), paging as (
    select case when p_page_size is null then 1 else least(p_page,greatest(1,ceil(count::numeric/p_page_size)::integer)) end page from totals
  ), selected as (
    select * from period where p_page_size is null or
      number between ((select page from paging)-1)::bigint*p_page_size+1 and (select page from paging)::bigint*p_page_size
    order by number
  )
  select jsonb_build_object('opening',o.amount,'money_in',t.money_in,'money_out',t.money_out,
    'closing',o.amount+t.money_in-t.money_out,'count',t.count,'page',pg.page,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',source || ':' || id,'number',number,'date',transaction_date,
      'particulars',particulars,'description',description,'season',season,'money_in',greatest(delta,0),
      'money_out',greatest(-delta,0),'balance',balance) order by number) from selected),'[]'::jsonb))
  into v_result from opening o cross join totals t cross join paging pg;
  return v_result;
end; $$;
revoke all on function public.admin_club_cash_report(uuid,date,date,uuid,integer,integer) from public,anon;
grant execute on function public.admin_club_cash_report(uuid,date,date,uuid,integer,integer) to authenticated;
