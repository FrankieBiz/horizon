-- 004_weekly: weekly check-ins, engine output, and observability.

create table weekly_checkins (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  energy int not null check (energy between 1 and 5),
  soreness int not null check (soreness between 1 and 5),
  sleep_quality int not null check (sleep_quality between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table weekly_checkins enable row level security;
create policy "own rows" on weekly_checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table weekly_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  metrics_json jsonb not null,     -- assembled WeeklyData input (auditability)
  findings_json jsonb not null,    -- domain_analyses + wins + focus_areas
  coach_message text not null,
  model_version text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table weekly_summaries enable row level security;
create policy "own rows" on weekly_summaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  weekly_summary_id uuid not null references weekly_summaries (id) on delete cascade,
  category text not null
    check (category in ('sleep', 'recovery', 'nutrition', 'exercise', 'habits')),
  priority int not null,
  message text not null,
  rationale text not null,
  status text not null default 'delivered'
    check (status in ('delivered', 'read', 'acted', 'dismissed')),
  created_at timestamptz not null default now()
);
create index recommendations_user on recommendations (user_id, created_at desc);
alter table recommendations enable row level security;
create policy "own rows" on recommendations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- LLM observability: every weekly run, reproducible by (input_hash, prompt_version).
create table coach_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'fallback')),
  prompt_version text,
  model_version text,
  input_hash text,
  tokens_in int,
  tokens_out int,
  cost_usd numeric(8, 4),
  error text,
  composed_prompt text,            -- retained for failed/fallback runs only
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, week_start)
);
alter table coach_runs enable row level security;
create policy "own rows readonly" on coach_runs
  for select using (auth.uid() = user_id);
