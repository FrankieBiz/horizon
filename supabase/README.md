# Supabase schema

The numbered SQL files in `migrations/` define Horizon's Postgres schema and
row level security policies.

For a new database, run `pnpm --filter horizon-api migrate` with `DATABASE_URL`
set. The migration script replays every file and is intended for a new database.

For an existing database, the API applies `migrations/005_weekly_goals.sql`
transactionally during startup if `weekly_goals` is absent, then verifies the
required columns, index, and row level security before accepting requests.
You can also apply that single file manually before deployment. Weekly goal
sync and account export depend on the new table.
