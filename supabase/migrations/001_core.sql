-- 001_core: profiles + daily metric tables + workouts.
-- RLS enabled in the same migration that creates each table (spec §8 checklist).
-- The API connects with the service role (bypasses RLS); policies exist as
-- defense-in-depth for any PostgREST/direct access.

create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'America/New_York',
  goals_json jsonb not null default '{
    "sleep_need_min": 450,
    "protein_target_g": 140,
    "calorie_target_kcal": null,
    "weekly_workout_target": 3,
    "primary_goal": "longevity"
  }'::jsonb,
  units text not null default 'imperial',
  apns_token text,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "own profile" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Shared shape: one row per user per local_date; (user_id, local_date) is the
-- idempotency key. source: 'manual' beats 'healthkit' (enforced in the API's
-- upsert), healthkit never overwrites manual.

create table sleep_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  total_min int not null,
  in_bed_min int not null,
  deep_min int,
  rem_min int,
  core_min int,
  awake_min int,
  bedtime_at timestamptz,
  waketime_at timestamptz,
  source text not null check (source in ('healthkit', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table sleep_daily enable row level security;
create policy "own rows" on sleep_daily
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table vitals_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  resting_hr double precision,
  hrv_sdnn_ms double precision,
  respiratory_rate double precision,
  source text not null check (source in ('healthkit', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table vitals_daily enable row level security;
create policy "own rows" on vitals_daily
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table activity_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  steps int not null default 0,
  active_energy_kcal double precision not null default 0,
  exercise_min int not null default 0,
  source text not null check (source in ('healthkit', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table activity_daily enable row level security;
create policy "own rows" on activity_daily
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table nutrition_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  calories_kcal double precision,
  protein_g double precision,
  carbs_g double precision,
  fat_g double precision,
  water_ml double precision,
  source text not null check (source in ('healthkit', 'manual')),
  is_complete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table nutrition_daily enable row level security;
create policy "own rows" on nutrition_daily
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table body_metrics (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  weight_kg double precision,
  body_fat_pct double precision,
  source text not null check (source in ('healthkit', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);
alter table body_metrics enable row level security;
create policy "own rows" on body_metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Workouts are per-event, keyed by the client-provided sync identifier
-- (HKMetadataKeySyncIdentifier or client UUID for manual entries).
create table workouts (
  user_id uuid not null references auth.users (id) on delete cascade,
  sync_identifier text not null,
  workout_type text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_min double precision not null,
  active_kcal double precision,
  avg_hr double precision,
  distance_m double precision,
  source text not null check (source in ('healthkit', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (user_id, sync_identifier)
);
create index workouts_user_start on workouts (user_id, start_at desc);
alter table workouts enable row level security;
create policy "own rows" on workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
