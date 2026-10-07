create extension if not exists pgcrypto;

create table if not exists public.ripplemap_investigations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (char_length(event) between 1 and 4000),
  symbols text[] not null default '{}',
  market_data jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ripplemap_investigations_user_created_idx on public.ripplemap_investigations(user_id,created_at desc);
alter table public.ripplemap_investigations enable row level security;

create policy "owners read investigations" on public.ripplemap_investigations for select to authenticated using ((select auth.uid())=user_id or is_public=true);
create policy "public reads shared investigations" on public.ripplemap_investigations for select to anon using (is_public=true);
create policy "owners create investigations" on public.ripplemap_investigations for insert to authenticated with check ((select auth.uid())=user_id);
create policy "owners update investigations" on public.ripplemap_investigations for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "owners delete investigations" on public.ripplemap_investigations for delete to authenticated using ((select auth.uid())=user_id);

grant select on public.ripplemap_investigations to anon;
grant select,insert,update,delete on public.ripplemap_investigations to authenticated;

create table if not exists public.ripplemap_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  anonymous_session_id text not null check (char_length(anonymous_session_id) between 8 and 100),
  event_name text not null check (char_length(event_name) between 1 and 80),
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ripplemap_events_user_id_idx on public.ripplemap_events(user_id) where user_id is not null;

alter table public.ripplemap_events enable row level security;
create policy "clients create analytics events" on public.ripplemap_events for insert to anon,authenticated with check (user_id is null or (select auth.uid())=user_id);
grant insert on public.ripplemap_events to anon,authenticated;
grant usage,select on sequence public.ripplemap_events_id_seq to anon,authenticated;
