alter table public.payments
  add column if not exists session_id uuid references public.sessions(id) on delete set null;

create index if not exists payments_session_id_idx on public.payments(session_id);
