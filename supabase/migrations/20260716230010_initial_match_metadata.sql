-- Grindion's durable metadata only. High-frequency arena simulation belongs in
-- an authoritative game server, not Postgres or database change feeds.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'waiting'
    check (status in ('waiting', 'running', 'finished', 'cancelled')),
  max_players smallint not null default 12 check (max_players between 2 and 40),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or started_at is not null),
  check (ended_at is null or ended_at >= started_at)
);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (match_id, player_id),
  check (left_at is null or left_at >= joined_at)
);

create table public.match_results (
  match_id uuid not null,
  player_id uuid not null,
  placement smallint not null check (placement > 0),
  final_score integer not null check (final_score >= 0),
  eliminations integer not null default 0 check (eliminations >= 0),
  deaths integer not null default 0 check (deaths >= 0),
  recorded_at timestamptz not null default now(),
  primary key (match_id, player_id),
  unique (match_id, placement),
  foreign key (match_id, player_id)
    references public.match_players (match_id, player_id)
    on delete cascade
);

create index matches_host_id_idx on public.matches (host_id);
create index matches_status_created_at_idx on public.matches (status, created_at desc);
create index match_players_player_id_idx on public.match_players (player_id);
create index match_results_player_score_idx
  on public.match_results (player_id, final_score desc);

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_results enable row level security;

-- Profiles and match summaries are game-facing data, but only signed-in users
-- can read them. Anonymous Supabase Auth users still use the authenticated role.
create policy "authenticated users can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "authenticated users can read matches"
  on public.matches for select
  to authenticated
  using (true);

create policy "users can create hosted matches"
  on public.matches for insert
  to authenticated
  with check ((select auth.uid()) = host_id);

-- Host updates are suitable for prototype lobby metadata only. A production
-- coordinator should perform lifecycle transitions with a server credential.
create policy "hosts can update their matches"
  on public.matches for update
  to authenticated
  using ((select auth.uid()) = host_id)
  with check ((select auth.uid()) = host_id);

create policy "authenticated users can read match players"
  on public.match_players for select
  to authenticated
  using (true);

create policy "users can join waiting matches as themselves"
  on public.match_players for insert
  to authenticated
  with check (
    (select auth.uid()) = player_id
    and exists (
      select 1
      from public.matches
      where matches.id = match_id
        and matches.status = 'waiting'
    )
  );

create policy "users can leave their own match row"
  on public.match_players for delete
  to authenticated
  using (
    (select auth.uid()) = player_id
    and exists (
      select 1
      from public.matches
      where matches.id = match_id
        and matches.status = 'waiting'
    )
  );

create policy "authenticated users can read match results"
  on public.match_results for select
  to authenticated
  using (true);

-- New Supabase projects may not expose SQL-created tables automatically.
-- These grants expose only the operations protected by the RLS policies above.
grant select on table public.profiles to authenticated;
grant insert (id, display_name), update (display_name)
  on table public.profiles to authenticated;
grant select on table public.matches to authenticated;
grant insert (host_id, max_players),
  update (status, max_players, started_at, ended_at)
  on table public.matches to authenticated;
grant select on table public.match_players to authenticated;
grant insert (match_id, player_id), delete
  on table public.match_players to authenticated;
grant select on table public.match_results to authenticated;

grant all on table public.profiles to service_role;
grant all on table public.matches to service_role;
grant all on table public.match_players to service_role;
grant all on table public.match_results to service_role;
