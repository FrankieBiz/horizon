import type {
  ActivityDay, BiomarkerPanel, BodyDay, HabitLog, NutritionDay,
  SleepDay, VitalsDay, WeeklyCheckin, WorkoutRecord,
} from "@horizon/shared";
import type { Queryable } from "../db/pool.js";

// Idempotent per-domain upserts. Conflict rule (prep spec §3): manual
// overwrites healthkit for the same key; healthkit NEVER overwrites manual.
// The WHERE clause on DO UPDATE enforces it — a healthkit write landing on a
// manual row is a no-op.
const MANUAL_WINS = (table: string) =>
  `not (${table}.source = 'manual' and excluded.source = 'healthkit')`;

export async function upsertSleepDays(db: Queryable, userId: string, days: SleepDay[]): Promise<number> {
  let upserted = 0;
  for (const d of days) {
    const res = await db.query(
      `insert into sleep_daily
         (user_id, local_date, total_min, in_bed_min, deep_min, rem_min, core_min,
          awake_min, bedtime_at, waketime_at, source, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       on conflict (user_id, local_date) do update set
         total_min = excluded.total_min,
         in_bed_min = excluded.in_bed_min,
         deep_min = excluded.deep_min,
         rem_min = excluded.rem_min,
         core_min = excluded.core_min,
         awake_min = excluded.awake_min,
         bedtime_at = excluded.bedtime_at,
         waketime_at = excluded.waketime_at,
         source = excluded.source,
         updated_at = now()
       where ${MANUAL_WINS("sleep_daily")}`,
      [userId, d.local_date, d.total_min, d.in_bed_min, d.deep_min ?? null,
       d.rem_min ?? null, d.core_min ?? null, d.awake_min ?? null,
       d.bedtime_at ?? null, d.waketime_at ?? null, d.source]
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

export async function upsertVitalsDays(db: Queryable, userId: string, days: VitalsDay[]): Promise<number> {
  let upserted = 0;
  for (const d of days) {
    const res = await db.query(
      `insert into vitals_daily
         (user_id, local_date, resting_hr, hrv_sdnn_ms, respiratory_rate, source, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (user_id, local_date) do update set
         resting_hr = excluded.resting_hr,
         hrv_sdnn_ms = excluded.hrv_sdnn_ms,
         respiratory_rate = excluded.respiratory_rate,
         source = excluded.source,
         updated_at = now()
       where ${MANUAL_WINS("vitals_daily")}`,
      [userId, d.local_date, d.resting_hr ?? null, d.hrv_sdnn_ms ?? null,
       d.respiratory_rate ?? null, d.source]
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

export async function upsertActivityDays(db: Queryable, userId: string, days: ActivityDay[]): Promise<number> {
  let upserted = 0;
  for (const d of days) {
    const res = await db.query(
      `insert into activity_daily
         (user_id, local_date, steps, active_energy_kcal, exercise_min, source, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (user_id, local_date) do update set
         steps = excluded.steps,
         active_energy_kcal = excluded.active_energy_kcal,
         exercise_min = excluded.exercise_min,
         source = excluded.source,
         updated_at = now()
       where ${MANUAL_WINS("activity_daily")}`,
      [userId, d.local_date, d.steps, d.active_energy_kcal, d.exercise_min, d.source]
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

export async function upsertNutritionDays(db: Queryable, userId: string, days: NutritionDay[]): Promise<number> {
  let upserted = 0;
  for (const d of days) {
    const res = await db.query(
      `insert into nutrition_daily
         (user_id, local_date, calories_kcal, protein_g, carbs_g, fat_g, water_ml,
          source, is_complete, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       on conflict (user_id, local_date) do update set
         calories_kcal = excluded.calories_kcal,
         protein_g = excluded.protein_g,
         carbs_g = excluded.carbs_g,
         fat_g = excluded.fat_g,
         water_ml = excluded.water_ml,
         source = excluded.source,
         is_complete = excluded.is_complete,
         updated_at = now()
       where ${MANUAL_WINS("nutrition_daily")}`,
      [userId, d.local_date, d.calories_kcal ?? null, d.protein_g ?? null,
       d.carbs_g ?? null, d.fat_g ?? null, d.water_ml ?? null, d.source, d.is_complete]
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

export async function upsertBodyDays(db: Queryable, userId: string, days: BodyDay[]): Promise<number> {
  let upserted = 0;
  for (const d of days) {
    const res = await db.query(
      `insert into body_metrics
         (user_id, local_date, weight_kg, body_fat_pct, source, updated_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (user_id, local_date) do update set
         weight_kg = excluded.weight_kg,
         body_fat_pct = excluded.body_fat_pct,
         source = excluded.source,
         updated_at = now()
       where ${MANUAL_WINS("body_metrics")}`,
      [userId, d.local_date, d.weight_kg ?? null, d.body_fat_pct ?? null, d.source]
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

export async function upsertWorkouts(db: Queryable, userId: string, workouts: WorkoutRecord[]): Promise<number> {
  let upserted = 0;
  for (const w of workouts) {
    const res = await db.query(
      `insert into workouts
         (user_id, sync_identifier, workout_type, start_at, end_at, duration_min,
          active_kcal, avg_hr, distance_m, source, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       on conflict (user_id, sync_identifier) do update set
         workout_type = excluded.workout_type,
         start_at = excluded.start_at,
         end_at = excluded.end_at,
         duration_min = excluded.duration_min,
         active_kcal = excluded.active_kcal,
         avg_hr = excluded.avg_hr,
         distance_m = excluded.distance_m,
         updated_at = now()`,
      [userId, w.sync_identifier, w.workout_type, w.start_at, w.end_at,
       w.duration_min, w.active_kcal ?? null, w.avg_hr ?? null,
       w.distance_m ?? null, w.source]
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

/** Habit logs auto-create the habit by name on first sight (client is source of truth for the roster). */
export async function upsertHabitLogs(db: Queryable, userId: string, logs: HabitLog[]): Promise<number> {
  let upserted = 0;
  for (const log of logs) {
    const habit = await db.query(
      `insert into habits (user_id, name)
       values ($1, $2)
       on conflict (user_id, name) do update set name = excluded.name
       returning id`,
      [userId, log.habit_name]
    );
    const habitId = habit.rows[0].id;
    await db.query(
      `insert into habit_schedules (habit_id) values ($1) on conflict do nothing`,
      [habitId]
    );
    const res = await db.query(
      `insert into habit_logs (user_id, habit_id, local_date, value, completed_at, timezone)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (habit_id, local_date) do update set
         value = excluded.value,
         completed_at = excluded.completed_at,
         timezone = excluded.timezone`,
      [userId, habitId, log.local_date, log.value, log.completed_at, log.timezone]
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

export async function upsertCheckins(db: Queryable, userId: string, checkins: WeeklyCheckin[]): Promise<number> {
  let upserted = 0;
  for (const c of checkins) {
    const res = await db.query(
      `insert into weekly_checkins (user_id, week_start, energy, soreness, sleep_quality)
       values ($1,$2,$3,$4,$5)
       on conflict (user_id, week_start) do update set
         energy = excluded.energy,
         soreness = excluded.soreness,
         sleep_quality = excluded.sleep_quality`,
      [userId, c.week_start, c.energy, c.soreness, c.sleep_quality]
    );
    upserted += res.rowCount ?? 0;
  }
  return upserted;
}

export async function upsertBiomarkerPanels(db: Queryable, userId: string, panels: BiomarkerPanel[]): Promise<number> {
  let upserted = 0;
  for (const p of panels) {
    const panelRes = await db.query(
      `insert into biomarker_panels (user_id, client_id, drawn_on, lab_name, notes)
       values ($1,$2,$3,$4,$5)
       on conflict (user_id, client_id) do update set
         drawn_on = excluded.drawn_on,
         lab_name = excluded.lab_name,
         notes = excluded.notes
       returning id`,
      [userId, p.client_id, p.drawn_on, p.lab_name, p.notes ?? null]
    );
    const panelId = panelRes.rows[0].id;
    // Replace results wholesale — a re-synced panel is authoritative.
    await db.query(`delete from biomarker_results where panel_id = $1`, [panelId]);
    for (const r of p.results) {
      await db.query(
        `insert into biomarker_results (panel_id, marker, value, unit, ref_low, ref_high, lab_flag)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [panelId, r.marker, r.value, r.unit, r.ref_low ?? null, r.ref_high ?? null, r.lab_flag ?? null]
      );
    }
    upserted += 1;
  }
  return upserted;
}
