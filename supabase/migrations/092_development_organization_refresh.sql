-- No target is enabled by this migration. Operators configure development only.
create table public.development_refresh_targets (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  source_ref text not null check(source_ref = 'uqntqbcimkyoiptvtrem'),
  target_ref text not null check(target_ref = 'vnmloamscqaqmagimfmz'),
  check(source_ref <> target_ref)
);
create table public.development_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'analyze_queued' check(status in
    ('analyze_queued','analyzing','preview_ready','apply_queued','applying','succeeded','failed','cancelled','expired')),
  preview jsonb,
  snapshot_hash text,
  error text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index development_refresh_one_active on public.development_refresh_jobs(organization_id)
  where status in ('analyze_queued','analyzing','preview_ready','apply_queued','applying');

alter table public.development_refresh_targets enable row level security;
alter table public.development_refresh_jobs enable row level security;
revoke all on public.development_refresh_targets,public.development_refresh_jobs from public,anon,authenticated;
grant select on public.development_refresh_jobs to authenticated;
grant all on public.development_refresh_targets,public.development_refresh_jobs to service_role;
create policy refresh_jobs_admin_read on public.development_refresh_jobs for select to authenticated using (
  exists(select 1 from public.organization_members m where m.organization_id=development_refresh_jobs.organization_id
    and m.profile_id=auth.uid() and m.status='active' and m.role in ('owner','admin'))
);

create function public.request_development_refresh(p_organization_id uuid, p_job_id uuid default null, p_command text default 'analyze')
returns uuid language plpgsql security definer set search_path=public as $$
declare job public.development_refresh_jobs; result uuid;
begin
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id
    and profile_id=auth.uid() and status='active' and role in ('owner','admin')) then
    raise exception 'Only an active organization owner or admin can refresh its development data';
  end if;
  if not exists(select 1 from public.development_refresh_targets where organization_id=p_organization_id and enabled
    and source_ref='uqntqbcimkyoiptvtrem' and target_ref='vnmloamscqaqmagimfmz') then
    raise exception 'Production refresh is not configured for this organization';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 92));
  update public.development_refresh_jobs set status='expired',updated_at=now()
    where organization_id=p_organization_id and status='preview_ready' and expires_at <= now();
  if p_command='analyze' then
    insert into public.development_refresh_jobs(organization_id,requested_by)
      values(p_organization_id,auth.uid()) returning id into result;
  else
    select * into job from public.development_refresh_jobs where id=p_job_id and organization_id=p_organization_id for update;
    if job.id is null or job.requested_by<>auth.uid() then raise exception 'Refresh request was not found'; end if;
    if p_command='confirm' then
      if job.status<>'preview_ready' or job.expires_at<=now() then raise exception 'Analyze again before confirming'; end if;
      update public.development_refresh_jobs set status='apply_queued',updated_at=now() where id=job.id;
    elsif p_command='cancel' and job.status in ('analyze_queued','preview_ready','apply_queued') then
      update public.development_refresh_jobs set status='cancelled',updated_at=now() where id=job.id;
    else raise exception 'This refresh cannot be changed'; end if;
    result:=job.id;
  end if;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,new_data)
    values(p_organization_id,auth.uid(),'development_refresh_'||p_command,'development_refresh_jobs',result,
      jsonb_build_object('direction','production_to_development'));
  return result;
end $$;
revoke all on function public.request_development_refresh(uuid,uuid,text) from public,anon;
grant execute on function public.request_development_refresh(uuid,uuid,text) to authenticated;
