import { z } from "zod";
import type { Queryable } from "../db/pool.js";

export const profileUpdate = z.object({
  timezone: z.string().min(1).max(64).optional(),
  apns_token: z.string().min(16).max(400).nullish(),
  goals: z.object({
    sleep_need_min: z.number().int().min(240).max(720).optional(),
    protein_target_g: z.number().int().min(30).max(400).nullable().optional(),
    calorie_target_kcal: z.number().int().min(800).max(10000).nullable().optional(),
    weekly_workout_target: z.number().int().min(0).max(14).nullable().optional(),
    primary_goal: z.string().max(60).optional(),
  }).optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdate>;

/** Upsert the profile row; goals merge into goals_json rather than replacing it. */
export async function updateProfile(db: Queryable, userId: string, update: ProfileUpdate): Promise<void> {
  await db.query(
    `insert into profiles (user_id, timezone, goals_json, apns_token)
     values ($1, coalesce($2, 'America/New_York'), coalesce($3::jsonb, '{}'::jsonb), $4)
     on conflict (user_id) do update set
       timezone = coalesce($2, profiles.timezone),
       goals_json = profiles.goals_json || coalesce($3::jsonb, '{}'::jsonb),
       apns_token = coalesce($4, profiles.apns_token)`,
    [userId, update.timezone ?? null,
     update.goals ? JSON.stringify(update.goals) : null,
     update.apns_token ?? null]
  );
}

export async function getProfile(db: Queryable, userId: string): Promise<Record<string, unknown> | null> {
  const res = await db.query(
    `select timezone, goals_json, created_at from profiles where user_id = $1`, [userId]);
  return res.rows[0] ?? null;
}
