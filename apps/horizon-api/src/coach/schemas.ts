import { z } from "zod";
import {
  activityDay, bodyDay, domainAnalysis, nutritionDay, recommendation,
  sleepDay, vitalsDay, weeklyCheckin, workoutRecord,
} from "@horizon/shared";

// ---- WeeklyData: everything the model is allowed to see (input) ----

export const findingSchema = z.object({
  code: z.string(),                 // e.g. "sleep_consistency_low"
  domain: z.enum(["sleep_recovery", "nutrition", "exercise", "habits", "biomarkers", "data"]),
  severity: z.enum(["info", "attention", "priority"]),
  evidence: z.string(),             // human-readable, numbers included
  metrics: z.record(z.number().nullable()).optional(),
});
export type Finding = z.infer<typeof findingSchema>;

export const habitWeekSchema = z.object({
  name: z.string(),
  kind: z.enum(["habit", "supplement"]),
  due_days: z.number().int(),       // how many days it was due this week
  done_days: z.number().int(),
  adherence_30d_pct: z.number().nullable(),
  adherence_week_pct: z.number().nullable(),
});

export const biomarkerFlagSchema = z.object({
  marker: z.string(),
  value: z.number(),
  unit: z.string(),
  ref_low: z.number().nullable(),
  ref_high: z.number().nullable(),
  out_of_range: z.boolean(),
  drawn_on: z.string(),
  trend: z.enum(["first_panel", "rising", "falling", "stable"]).nullable(),
});

export const weeklyDataSchema = z.object({
  week_start: z.string(),
  timezone: z.string(),
  profile: z.object({
    sleep_need_min: z.number(),
    protein_target_g: z.number().nullable(),
    calorie_target_kcal: z.number().nullable(),
    weekly_workout_target: z.number().nullable(),
    primary_goal: z.string(),
  }),
  week: z.object({
    sleep: z.array(sleepDay),
    vitals: z.array(vitalsDay),
    activity: z.array(activityDay),
    nutrition: z.array(nutritionDay),
    body: z.array(bodyDay),
    workouts: z.array(workoutRecord),
    habits: z.array(habitWeekSchema),
    checkin: weeklyCheckin.nullable(),
  }),
  baselines: z.object({
    hrv_60d_mean: z.number().nullable(),
    hrv_60d_sd: z.number().nullable(),
    rhr_60d_mean: z.number().nullable(),
    rhr_60d_sd: z.number().nullable(),
    sleep_60d_mean_min: z.number().nullable(),
    steps_28d_median: z.number().nullable(),
    acute_load_7d: z.number().nullable(),
    chronic_load_28d: z.number().nullable(),
    baseline_days_available: z.number().int(),
  }),
  findings: z.array(findingSchema),
  biomarkers: z.object({
    new_panel: z.boolean(),
    flags: z.array(biomarkerFlagSchema),
  }),
  last_week: z.object({
    coach_message: z.string().nullable(),
    recommendations: z.array(z.object({
      category: z.string(),
      message: z.string(),
      status: z.string(),
    })),
  }),
});
export type WeeklyData = z.infer<typeof weeklyDataSchema>;

// ---- WeeklySummary: the structured output contract for the Claude call ----

export const weeklySummarySchema = z.object({
  domain_analyses: z.array(domainAnalysis).min(1).max(5),
  wins: z.array(z.string().min(1).max(300)).min(1).max(5),
  focus_areas: z.array(z.string().min(1).max(300)).min(1).max(3),
  coach_message: z.string().min(40).max(1600),
  recommendations: z.array(recommendation.omit({ id: true, status: true })).min(1).max(3),
  safety_self_check: z.object({
    no_diagnosis_language: z.boolean(),
    no_medication_or_dosage_advice: z.boolean(),
    biomarker_phrasing_compliant: z.boolean(),
    notes: z.string().max(500),
  }),
});
export type WeeklySummary = z.infer<typeof weeklySummarySchema>;

/** JSON Schema for the API's structured-output format parameter. */
export { zodToJsonSchema } from "zod-to-json-schema";
