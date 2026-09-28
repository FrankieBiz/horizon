# Supabase schema

The numbered SQL files in `migrations/` define Horizon's Postgres schema and
row level security policies.

For a new database, run `pnpm --filter horizon-api migrate` with `DATABASE_URL`
set. The migration script replays every file and is intended for a new database.

For an existing database, apply only the new migration file
`migrations/005_weekly_goals.sql` before deploying the API and iOS app changes.
Weekly goal sync and account export depend on the new table.
