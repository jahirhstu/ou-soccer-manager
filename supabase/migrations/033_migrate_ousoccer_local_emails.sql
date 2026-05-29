do $$
declare
  migrated_count integer;
  skipped_count integer;
begin
  create temp table ou_soccer_email_candidates on commit drop as
  select
    old_user.id user_id,
    old_user.email old_email,
    regexp_replace(old_user.email, '@ousoccer\.local$', '@ou.soccer') new_email,
    existing.id existing_user_id
  from auth.users old_user
  left join auth.users existing
    on lower(existing.email) = lower(regexp_replace(old_user.email, '@ousoccer\.local$', '@ou.soccer'))
   and existing.id <> old_user.id
  where lower(old_user.email) like '%@ousoccer.local';

  create temp table ou_soccer_email_updates on commit drop as
  select user_id, old_email, new_email
  from ou_soccer_email_candidates
  where existing_user_id is null;

  select count(*) into skipped_count
  from ou_soccer_email_candidates
  where existing_user_id is not null;

  update auth.users users
  set
    email = updates.new_email,
    email_confirmed_at = coalesce(users.email_confirmed_at, now()),
    updated_at = now()
  from ou_soccer_email_updates updates
  where users.id = updates.user_id;

  update auth.identities identities
  set
    provider_id = case
      when identities.provider = 'email' then updates.new_email
      else identities.provider_id
    end,
    identity_data = jsonb_set(
      coalesce(identities.identity_data, '{}'::jsonb),
      '{email}',
      to_jsonb(updates.new_email)
    ),
    updated_at = now()
  from ou_soccer_email_updates updates
  where identities.user_id = updates.user_id;

  update public.profiles profiles
  set
    email = updates.new_email,
    updated_at = now()
  from ou_soccer_email_updates updates
  where profiles.id = updates.user_id;

  select count(*) into migrated_count
  from ou_soccer_email_updates;

  raise notice 'Migrated % @ousoccer.local email(s) to @ou.soccer. Skipped % because the target @ou.soccer user already exists.', migrated_count, skipped_count;
end;
$$;
