create table if not exists public.player_aliases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  alias_name text not null,
  normalized_alias text not null unique,
  match_count integer not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_used_at timestamptz default now()
);

insert into public.player_aliases(player_id, alias_name, normalized_alias)
select id, display_name, lower(regexp_replace(trim(display_name), '[^a-zA-Z0-9]', '', 'g'))
from public.players
on conflict (normalized_alias) do nothing;

create index if not exists player_aliases_player_id_idx on public.player_aliases(player_id);
create index if not exists player_aliases_normalized_alias_idx on public.player_aliases(normalized_alias);

drop trigger if exists player_aliases_updated_at on public.player_aliases;
create trigger player_aliases_updated_at before update on public.player_aliases for each row execute function public.set_updated_at();

alter table public.player_aliases enable row level security;

drop policy if exists "player_aliases_select" on public.player_aliases;
create policy "player_aliases_select" on public.player_aliases for select using (auth.uid() is not null);

drop policy if exists "player_aliases_admin_all" on public.player_aliases;
create policy "player_aliases_admin_all" on public.player_aliases for all using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

grant all on table public.player_aliases to authenticated, service_role;
