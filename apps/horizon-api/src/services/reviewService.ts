import type { Queryable } from "../db/pool.js";
import type { WeeklyReview } from "@horizon/shared";

/** Fetch the latest (or a specific week's) review with its recommendations. */
export async function getReview(
  db: Queryable, userId: string, weekStart?: string
): Promise<WeeklyReview | null> {
  const summaryRes = weekStart
    ? await db.query(
        `select * from weekly_summaries where user_id = $1 and week_start = $2`,
        [userId, weekStart])
    : await db.query(
        `select * from weekly_summaries where user_id = $1
         order by week_start desc limit 1`,
        [userId]);
  const summary = summaryRes.rows[0];
  if (!summary) return null;

  const recsRes = await db.query(
    `select id, category, priority, message, rationale, status
       from recommendations where weekly_summary_id = $1 order by priority`,
    [summary.id]);

  const findings = summary.findings_json ?? {};
  return {
    week_start: toLocalDate(summary.week_start),
    coach_message: summary.coach_message,
    wins: findings.wins ?? [],
    focus_areas: findings.focus_areas ?? [],
    domain_analyses: findings.domain_analyses ?? [],
    recommendations: recsRes.rows,
    created_at: new Date(summary.created_at).toISOString(),
  };
}

export async function markRecommendation(
  db: Queryable, userId: string, recommendationId: string, status: string
): Promise<void> {
  await db.query(
    `update recommendations set status = $3 where id = $2 and user_id = $1`,
    [userId, recommendationId, status]);
}

/** pg returns date columns as JS Dates; the wire format wants yyyy-MM-dd. */
function toLocalDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
