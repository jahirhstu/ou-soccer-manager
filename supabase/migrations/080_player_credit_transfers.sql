-- Player-to-player transfers move existing funds within one season, never cash receipts.
create or replace function public.transfer_player_credit(
  p_funding_player_id uuid, p_recipient_player_id uuid, p_season_id uuid,
  p_amount numeric, p_transfer_date date, p_session_id uuid, p_note text, p_submission_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons%rowtype;
  v_session public.sessions%rowtype;
  v_existing public.ledger_entries%rowtype;
  v_credit numeric;
  v_count integer;
  v_transfer_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
  v_funding_name text;
  v_recipient_name text;
begin
  select * into v_season from public.seasons where id = p_season_id;
  if v_season.id is null or public.organization_role(v_season.organization_id) is distinct from 'admin' then
    raise exception 'Only an organization admin can transfer player credit';
  end if;
  if v_season.program_id is null then raise exception 'Select a season belonging to a program'; end if;
  if p_submission_id is null then raise exception 'Submission ID is required'; end if;
  if p_funding_player_id is null or p_recipient_player_id is null or p_funding_player_id = p_recipient_player_id then
    raise exception 'Choose two different players';
  end if;
  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_amount <= 0 or p_amount > 99999999.99 or p_amount <> round(p_amount, 2) then
    raise exception 'Transfer amount must be positive and have at most two decimal places';
  end if;
  if p_transfer_date is null or p_transfer_date > (now() at time zone 'America/Toronto')::date then
    raise exception 'Enter a transfer date that is not in the future';
  end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'Transfer note is too long'; end if;
  if p_session_id is not null then
    select * into v_session from public.sessions where id = p_session_id;
    if v_session.id is null or v_session.season_id is distinct from v_season.id
      or v_session.organization_id is distinct from v_season.organization_id
      or v_session.program_id is distinct from v_season.program_id then
      raise exception 'Session must belong to the selected season and program';
    end if;
  end if;

  -- Match refund/carry-forward player locks; consistent ordering avoids opposing-transfer deadlocks.
  perform id from public.players
    where id in (p_funding_player_id, p_recipient_player_id)
      and organization_id = v_season.organization_id
    order by id for update;
  get diagnostics v_count = row_count;
  if v_count <> 2 then raise exception 'Both players must belong to this organization'; end if;

  select * into v_existing from public.ledger_entries where submission_id = p_submission_id;
  if found then
    if v_existing.type = 'credit_transferred_out'
      and v_existing.player_id = p_funding_player_id
      and v_existing.related_player_id = p_recipient_player_id
      and v_existing.season_id = p_season_id and v_existing.amount = p_amount
      and v_existing.session_id is not distinct from p_session_id
      and v_existing.transfer_date = p_transfer_date
      and v_existing.transfer_note is not distinct from nullif(btrim(p_note), '')
      and exists (select 1 from public.ledger_entries incoming
        where incoming.transfer_id = v_existing.transfer_id and incoming.type = 'credit_transferred_in'
          and incoming.player_id = p_recipient_player_id and incoming.related_player_id = p_funding_player_id
          and incoming.season_id = p_season_id and incoming.amount = p_amount) then
      return v_existing.transfer_id;
    end if;
    raise exception 'Submission ID is already used for another transaction';
  end if;

  select credit_amount into v_credit from public.player_season_payment_summary
    where player_id = p_funding_player_id and season_id = p_season_id;
  if coalesce(v_credit, 0) < p_amount then
    raise exception 'Transfer exceeds current season credit of %', coalesce(v_credit, 0);
  end if;
  select display_name into v_funding_name from public.players where id = p_funding_player_id;
  select display_name into v_recipient_name from public.players where id = p_recipient_player_id;
  insert into public.ledger_entries (
    organization_id, program_id, season_id, session_id, player_id, related_player_id,
    type, amount, sessions_count, transfer_id, transfer_date, transfer_note, submission_id, description, created_by
  ) values (
    v_season.organization_id, v_season.program_id, p_season_id, p_session_id, p_funding_player_id, p_recipient_player_id,
    'credit_transferred_out', p_amount, 0, v_transfer_id, p_transfer_date, nullif(btrim(p_note), ''), p_submission_id,
    'Credit sent to ' || v_recipient_name, auth.uid()
  ) returning id into v_out_id;
  insert into public.ledger_entries (
    organization_id, program_id, season_id, session_id, player_id, related_player_id,
    type, amount, sessions_count, transfer_id, transfer_date, transfer_note, description, created_by
  ) values (
    v_season.organization_id, v_season.program_id, p_season_id, p_session_id, p_recipient_player_id, p_funding_player_id,
    'credit_transferred_in', p_amount, 0, v_transfer_id, p_transfer_date, nullif(btrim(p_note), ''),
    'Credit received from ' || v_funding_name, auth.uid()
  ) returning id into v_in_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, new_data)
  values (v_season.organization_id, auth.uid(), 'player_credit_transferred', 'ledger_entries', v_out_id,
    jsonb_build_object('transfer_id', v_transfer_id, 'out_entry_id', v_out_id, 'in_entry_id', v_in_id,
      'funding_player_id', p_funding_player_id, 'recipient_player_id', p_recipient_player_id,
      'season_id', p_season_id, 'session_id', p_session_id, 'amount', p_amount,
      'transfer_date', p_transfer_date, 'note', nullif(btrim(p_note), '')));
  return v_transfer_id;
end;
$$;
revoke all on function public.transfer_player_credit(uuid, uuid, uuid, numeric, date, uuid, text, uuid) from public, anon;
grant execute on function public.transfer_player_credit(uuid, uuid, uuid, numeric, date, uuid, text, uuid) to authenticated;
