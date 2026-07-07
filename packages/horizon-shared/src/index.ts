import { z } from "zod";

// Shared wire contracts between horizon-ios / future clients and horizon-api.
// Wire format is snake_case (the iOS client encodes with convertToSnakeCase).
// Dates: local_date is "yyyy-MM-dd"; instants are ISO-8601 strings.

export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-MM-dd");
export const isoInstant = z.string().datetime({ offset: true });
export const metricSource = z.enum(["healthkit", "manual"]);

// ---- Daily domains ----

export const sleepDay = z.object({
  local_date: localDate,
  total_min: z.number().int().min(0).max(1600),
  in_bed_min: z.number().int().min(0).max(1600),
  deep_min: z.number().int().min(0).max(1600).nullish(),
  rem_min: z.number().int().min(0).max(1600).nullish(),
  core_min: z.number().int().min(0).max(1600).nullish(),
  awake_min: z.number().int().min(0).max(1600).nullish(),
  bedtime_at: isoInstant.nullish(),
  waketime_at: isoInstant.nullish(),
  source: metricSource,
});
export type SleepDay = z.infer<typeof sleepDay>;

export const vitalsDay = z.object({
  local_date: localDate,
  resting_hr: z.number().min(20).max(200).nullish(),
  hrv_sdnn_ms: z.number().min(0).max(500).nullish(),
  respiratory_rate: z.number().min(4).max(60).nullish(),
  source: metricSource,
});
export type VitalsDay = z.infer<typeof vitalsDay>;

export const activityDay = z.object({
  local_date: localDate,
  steps: z.number().int().min(0).max(200000),
  active_energy_kcal: z.number().min(0).max(20000),
  exercise_min: z.number().int().min(0).max(1440),
  source: metricSource,
});
export type ActivityDay = z.infer<typeof activityDay>;

export const nutritionDay = z.object({
  local_date: localDate,
  calories_kcal: z.number().min(0).max(20000).nullish(),
  protein_g: z.number().min(0).max(1500).nullish(),
  carbs_g: z.number().min(0).max(3000).nullish(),
  fat_g: z.number().min(0).max(1500).nullish(),
  water_ml: z.number().min(0).max(20000).nullish(),
  source: metricSource,
  is_complete: z.boolean(),
});
export type NutritionDay = z.infer<typeof nutritionDay>;

export const bodyDay = z.object({
  local_date: localDate,
  weight_kg: z.number().min(20).max(400).nullish(),
  body_fat_pct: z.number().min(1).max(75).nullish(),
  source: metricSource,
});
export type BodyDay = z.infer<typeof bodyDay>;

export const workoutRecord = z.object({
  sync_identifier: z.string().min(1).max(200),
  workout_type: z.string().min(1).max(100),
  start_at: isoInstant,
  end_at: isoInstant,
  duration_min: z.number().min(0).max(1440),
  active_kcal: z.number().min(0).max(10000).nullish(),
  avg_hr: z.number().min(20).max(230).nullish(),
  distance_m: z.number().min(0).max(500000).nullish(),
  source: metricSource,
});
export type WorkoutRecord = z.infer<typeof workoutRecord>;

export const habitLog = z.object({
  habit_name: z.string().min(1).max(120),
  local_date: localDate,
  value: z.number().min(0),
  completed_at: isoInstant,
  timezone: z.string().min(1).max(64),
});
export type HabitLog = z.infer<typeof habitLog>;

export const weeklyCheckin = z.object({
  week_start: localDate,
  energy: z.number().int().min(1).max(5),
  soreness: z.number().int().min(1).max(5),
  sleep_quality: z.number().int().min(1).max(5),
});
export type WeeklyCheckin = z.infer<typeof weeklyCheckin>;

export const biomarkerResult = z.object({
  marker: z.string().min(1).max(120),
  value: z.number(),
  unit: z.string().max(40),
  ref_low: z.number().nullish(),
  ref_high: z.number().nullish(),
  lab_flag: z.string().max(40).nullish(),
});
export const biomarkerPanel = z.object({
  client_id: z.string().min(1).max(100),
  drawn_on: localDate,
  lab_name: z.string().max(200),
  notes: z.string().max(4000).nullish(),
  results: z.array(biomarkerResult).min(1).max(100),
});
export type BiomarkerPanel = z.infer<typeof biomarkerPanel>;

// ---- Sync request envelopes ----

export const syncRequests = {
  sleep: z.object({ days: z.array(sleepDay).min(1).max(400) }),
  vitals: z.object({ days: z.array(vitalsDay).min(1).max(400) }),
  activity: z.object({ days: z.array(activityDay).min(1).max(400) }),
  nutrition: z.object({ days: z.array(nutritionDay).min(1).max(400) }),
  body: z.object({ days: z.array(bodyDay).min(1).max(400) }),
  workouts: z.object({ workouts: z.array(workoutRecord).min(1).max(1000) }),
  habitLogs: z.object({ logs: z.array(habitLog).min(1).max(1000) }),
  checkins: z.object({ checkins: z.array(weeklyCheckin).min(1).max(60) }),
  biomarkerPanels: z.object({ panels: z.array(biomarkerPanel).min(1).max(20) }),
} as const;

// ---- Weekly review (API -> client) ----

export const recommendation = z.object({
  id: z.string().uuid().optional(),
  category: z.enum(["sleep", "recovery", "nutrition", "exercise", "habits"]),
  priority: z.number().int().min(1).max(3),
  message: z.string().min(1).max(400),
  rationale: z.string().min(1).max(600),
  status: z.enum(["delivered", "read", "acted", "dismissed"]).default("delivered"),
});
export type Recommendation = z.infer<typeof recommendation>;

export const domainAnalysis = z.object({
  domain: z.enum(["sleep_recovery", "nutrition", "exercise", "habits", "biomarkers"]),
  observations: z.array(z.string().min(1).max(500)).max(6),
  severity: z.enum(["info", "attention", "priority"]),
  evidence: z.array(z.string().min(1).max(300)).max(6),
});
export type DomainAnalysis = z.infer<typeof domainAnalysis>;

export const weeklyReview = z.object({
  week_start: localDate,
  coach_message: z.string().min(1),
  wins: z.array(z.string()).max(5),
  focus_areas: z.array(z.string()).max(3),
  domain_analyses: z.array(domainAnalysis),
  recommendations: z.array(recommendation).max(3),
  created_at: isoInstant,
});
export type WeeklyReview = z.infer<typeof weeklyReview>;

// ---- Shared error contract (house pattern) ----

export const errorResponse = z.object({
  error: z.string(),
  code: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponse>;
