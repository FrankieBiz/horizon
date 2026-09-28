-- User-authored weekly outcomes and their checkable steps.
create table weekly_goals (
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null,
  week_start date not null,
  title text not null check (char_length(title) between 1 and 120),
  category text not null check (char_length(category) between 1 and 40),
  is_main boolean not null default false,
  is_deleted boolean not null default false,
  steps jsonb not null default '[]'::jsonb,
  revision int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, goal_id),
  check (jsonb_typeof(steps) = 'array')
);
create index weekly_goals_user_week on weekly_goals (user_id, week_start desc);
create unique index weekly_goals_one_main_per_week on weekly_goals (user_id, week_start)
  where is_main and not is_deleted;
alter table weekly_goals enable row level security;
create policy "own rows" on weekly_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
