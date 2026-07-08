import type { Queryable } from "../db/pool.js";

// The complete list of user-data tables, kept in sync with migrations.
// Used by both export (read) and delete (write) so the two can't drift.
const USER_TABLES = [
  "profiles",
  "sleep_daily",
  "vitals_daily",
  "activity_daily",
  "nutrition_daily",
  "body_metrics",
  "workouts",
  "habits", // habit_schedules / habit_logs / supplement_details cascade via FK
  "biomarker_panels", // biomarker_results cascade via FK
  "weekly_checkins",
  "weekly_summaries", // recommendations cascade via FK
  "coach_runs",
] as const;

/** Everything Horizon holds about a user, as one JSON object (privacy policy §5). */
export async function exportAccount(db: Queryable, userId: string): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const table of USER_TABLES) {
    const res = await db.query(`select * from ${table} where user_id = $1`, [userId]);
    dump[table] = res.rows;
  }
  // Child tables without a user_id column, joined through their parents.
  const habitChildren = await db.query(
    `select hl.* from habit_logs hl where hl.user_id = $1`, [userId]);
  dump["habit_logs"] = habitChildren.rows;
  const schedules = await db.query(
    `select s.* from habit_schedules s
       join habits h on h.id = s.habit_id
      where h.user_id = $1`, [userId]);
  dump["habit_schedules"] = schedules.rows;
  const supplements = await db.query(
    `select sd.* from supplement_details sd
       join habits h on h.id = sd.habit_id
      where h.user_id = $1`, [userId]);
  dump["supplement_details"] = supplements.rows;
  const results = await db.query(
    `select r.* from biomarker_results r
       join biomarker_panels p on p.id = r.panel_id
      where p.user_id = $1`, [userId]);
  dump["biomarker_results"] = results.rows;
  const recs = await db.query(
    `select * from recommendations where user_id = $1`, [userId]);
  dump["recommendations"] = recs.rows;
  return dump;
}

/** Delete every row for the user. The auth user itself is deleted separately. */
export async function deleteAccountRows(db: Queryable, userId: string): Promise<void> {
  // Reverse order isn't needed — all FKs cascade from these roots.
  for (const table of USER_TABLES) {
    await db.query(`delete from ${table} where user_id = $1`, [userId]);
  }
}

export type AuthAdminDeleter = (userId: string) => Promise<void>;

/** Production deleter: Supabase admin API removes the auth user (irreversible). */
export function supabaseAuthDeleter(supabaseUrl: string, serviceRoleKey: string): AuthAdminDeleter {
  return async (userId) => {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`auth user deletion failed: ${res.status}`);
    }
  };
}
