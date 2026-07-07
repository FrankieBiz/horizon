-- 002_habits: habits, schedules, logs, supplement details.
-- Loop-Habit-Tracker (N, M) frequency model + weekday bitmask (prep spec §4a).

create table habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'habit' check (kind in ('habit', 'supplement')),
  target_value double precision,
  target_type text,
  unit text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (user_id, name)
);
alter table habits enable row level security;
create policy "own rows" on habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table habit_schedules (
  habit_id uuid primary key references habits (id) on delete cascade,
  frequency_type text not null default 'daily'
    check (frequency_type in ('daily', 'n_times_per_week', 'specific_weekdays', 'as_needed', 'interval_days')),
  freq_numerator int not null default 1,
  freq_denominator int not null default 1,
  weekday_mask int not null default 0,
  interval_days int
);
alter table habit_schedules enable row level security;
create policy "own rows" on habit_schedules
  for all using (auth.uid() = (select user_id from habits where id = habit_id))
  with check (auth.uid() = (select user_id from habits where id = habit_id));

create table habit_logs (
  user_id uuid not null references auth.users (id) on delete cascade,
  habit_id uuid not null references habits (id) on delete cascade,
  local_date date not null,
  value double precision not null default 1,
  dose_amount_actual double precision,
  dose_unit_actual text,
  completed_at timestamptz not null default now(),
  timezone text not null,
  primary key (habit_id, local_date)
);
create index habit_logs_user_date on habit_logs (user_id, local_date desc);
alter table habit_logs enable row level security;
create policy "own rows" on habit_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table supplement_details (
  habit_id uuid primary key references habits (id) on delete cascade,
  product_name text,
  brand text,
  dose_amount double precision,
  dose_unit text,
  timing_of_day text
    check (timing_of_day in ('morning', 'midday', 'evening', 'with_food', 'empty_stomach')),
  route text
);
alter table supplement_details enable row level security;
create policy "own rows" on supplement_details
  for all using (auth.uid() = (select user_id from habits where id = habit_id))
  with check (auth.uid() = (select user_id from habits where id = habit_id));
