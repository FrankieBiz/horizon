import { z } from "zod";
import type { Queryable } from "../db/pool.js";

const step = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  is_complete: z.boolean(),
});

export const weeklyGoalSync = z.object({
  goals: z.array(z.object({
    goal_id: z.string().uuid(),
    week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(40),
    is_main: z.boolean(),
    is_deleted: z.boolean(),
    revision: z.number().int().min(0),
    steps: z.array(step).max(100),
  }).refine((goal) => goal.is_deleted || goal.steps.length > 0,
    "Active goals need at least one step")).max(100),
});

export type WeeklyGoalSync = z.infer<typeof weeklyGoalSync>;

export class WeeklyGoalConflict extends Error {
  constructor(public readonly goalId: string) {
    super("weekly goal changed on another device");
  }
}

export async function upsertWeeklyGoals(db: Queryable, userId: string,
                                        goals: WeeklyGoalSync["goals"]): Promise<Array<{ goal_id: string; revision: number }>> {
  const revisions: Array<{ goal_id: string; revision: number }> = [];
  for (const goal of goals) {
    if (goal.is_main && !goal.is_deleted) {
      // The route runs in one transaction. Serialize main-goal selections for
      // this user/week, then demote the old main before the unique index checks.
      await db.query(
        `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [userId, goal.week_start]);
      await db.query(
        `update weekly_goals set is_main = false,
           revision = revision + 1, updated_at = now()
         where user_id = $1 and week_start = $2 and goal_id <> $3
           and is_main and not is_deleted`,
        [userId, goal.week_start, goal.goal_id]);
    }
    const result = await db.query(
      `insert into weekly_goals
         (user_id, goal_id, week_start, title, category, is_main, is_deleted, steps)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (user_id, goal_id) do update set
         week_start = excluded.week_start,
         title = excluded.title,
         category = excluded.category,
         is_main = excluded.is_main,
         is_deleted = excluded.is_deleted,
         steps = excluded.steps,
         revision = weekly_goals.revision + 1,
         updated_at = now()
       where weekly_goals.revision = $9
       returning revision`,
      [userId, goal.goal_id, goal.week_start, goal.title, goal.category,
       goal.is_main, goal.is_deleted, JSON.stringify(goal.steps), goal.revision]);
    if (!result.rows.length) throw new WeeklyGoalConflict(goal.goal_id);
    revisions.push({ goal_id: goal.goal_id, revision: Number(result.rows[0]!.revision) });
  }
  return revisions;
}

export async function getWeeklyGoals(db: Queryable, userId: string): Promise<unknown[]> {
  const res = await db.query(
    `select goal_id, week_start::text as week_start, title, category,
            is_main, is_deleted, steps, revision
       from weekly_goals where user_id = $1
       order by week_start desc, updated_at desc`, [userId]);
  return res.rows;
}
