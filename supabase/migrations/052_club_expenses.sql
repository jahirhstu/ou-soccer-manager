create table if not exists public.club_expenses (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  expense_date date not null default current_date,
  category text not null check (category in ('dome_rent', 'food', 'jersey', 'equipment', 'other')),
  amount numeric(10,2) not null check (amount > 0),
  vendor text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists club_expenses_season_id_idx on public.club_expenses(season_id);
create index if not exists club_expenses_session_id_idx on public.club_expenses(session_id);
create index if not exists club_expenses_expense_date_idx on public.club_expenses(expense_date);
create index if not exists club_expenses_category_idx on public.club_expenses(category);

drop trigger if exists club_expenses_updated_at on public.club_expenses;
create trigger club_expenses_updated_at before update on public.club_expenses for each row execute function public.set_updated_at();

alter table public.club_expenses enable row level security;

drop policy if exists "club_expenses_admin_all" on public.club_expenses;
create policy "club_expenses_admin_all" on public.club_expenses
  for all
  using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');
