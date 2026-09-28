import { readFileSync } from "node:fs";
import type { Queryable } from "./pool.js";

type WithTransaction = <T>(run: (db: Queryable) => Promise<T>) => Promise<T>;

/** Apply the additive weekly-goals migration once, before serving requests. */
export async function ensureWeeklyGoalsSchema(withTransaction: WithTransaction): Promise<void> {
  await withTransaction(async (db) => {
    await db.query("select pg_advisory_xact_lock(73142, 5)");
    const existing = await db.query("select to_regclass('public.weekly_goals') as goal_table");
    if (!existing.rows[0]?.goal_table) {
      const sql = readFileSync(
        new URL("../../../../supabase/migrations/005_weekly_goals.sql", import.meta.url),
        "utf8");
      await db.query(sql);
    }
    const check = await db.query(`
      select
        (select count(*) = 9 from information_schema.columns
          where table_schema = 'public' and table_name = 'weekly_goals'
            and column_name in ('user_id', 'goal_id', 'week_start', 'title',
              'category', 'is_main', 'is_deleted', 'steps', 'revision'))
        and exists (select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'weekly_goals'
            and indexname = 'weekly_goals_one_main_per_week')
        and (select relrowsecurity from pg_class
          where oid = to_regclass('public.weekly_goals')) as ready`);
    if (check.rows[0]?.ready !== true) {
      throw new Error("weekly_goals schema is incomplete; refusing to start");
    }
  });
}
