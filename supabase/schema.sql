create table if not exists public.workspace_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.workspace_state enable row level security;

drop policy if exists "Public workspace can be read" on public.workspace_state;
create policy "Public workspace can be read"
on public.workspace_state for select
to anon
using (id = 'main');

drop policy if exists "Public workspace can be created" on public.workspace_state;
create policy "Public workspace can be created"
on public.workspace_state for insert
to anon
with check (id = 'main');

drop policy if exists "Public workspace can be updated" on public.workspace_state;
create policy "Public workspace can be updated"
on public.workspace_state for update
to anon
using (id = 'main')
with check (id = 'main');

grant select, insert, update on public.workspace_state to anon;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_state'
  ) then
    alter publication supabase_realtime add table public.workspace_state;
  end if;
end $$;
