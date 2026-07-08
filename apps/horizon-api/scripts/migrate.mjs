// Minimal migration runner (psql isn't required). Applies the numbered SQL
// files in order against DATABASE_URL. Idempotency is per-migration: re-running
// after a partial failure may error on already-created objects — migrations are
// authored to be run once on a fresh database.
//
// Usage:  DATABASE_URL='postgresql://...' node apps/horizon-api/scripts/migrate.mjs
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (with your real DB password) and re-run.");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");
const files = ["001_core.sql", "002_habits.sql", "003_biomarkers.sql", "004_weekly.sql"];

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const f of files) {
    process.stdout.write(`applying ${f} ... `);
    await client.query(readFileSync(join(migrationsDir, f), "utf8"));
    console.log("ok");
  }
  // Sanity check: confirm the tables the app depends on now exist.
  const { rows } = await client.query(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public'
        and table_name in ('profiles','sleep_daily','weekly_summaries','coach_runs')`
  );
  console.log(`verified ${rows[0].n}/4 key tables present`);
  console.log("all migrations applied");
} finally {
  await client.end();
}
