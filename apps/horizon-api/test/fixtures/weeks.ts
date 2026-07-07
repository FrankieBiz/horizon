import type { WeeklyData } from "../../src/coach/schemas.js";

// Deterministic fixture weeks for golden tests (prep spec Phase 3):
// normal, sparse, travel, first-week, biomarker.

const base = {
  week_start: "2026-06-29",
  timezone: "America/New_York",
  profile: {
    sleep_need_min: 450,
    protein_target_g: 140,
    calorie_target_kcal: null,
    weekly_workout_target: 3,
    primary_goal: "longevity",
  },
};

function days(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `2026-07-0${i < 6 ? i + 1 : 5}`).slice(0, n).map((d, i) => `2026-06-${29 + i > 30 ? `0${29 + i - 30}` : 29 + i}`)
    .map((_, i) => {
      const day = 29 + i;
      return day <= 30 ? `2026-06-${day}` : `2026-07-0${day - 30}`;
    });
}

const WEEK_DATES = days(7);

export function normalWeek(): WeeklyData {
  return {
    ...base,
    week: {
      sleep: WEEK_DATES.map((d, i) => ({
        local_date: d, total_min: 400 + i * 8, in_bed_min: 450 + i * 8,
        deep_min: 55, rem_min: 85, core_min: 260 + i * 8, awake_min: 18,
        bedtime_at: `${d}T03:10:00Z`, waketime_at: `${d}T11:00:00Z`,
        source: "healthkit" as const,
      })),
      vitals: WEEK_DATES.map((d) => ({
        local_date: d, resting_hr: 52, hrv_sdnn_ms: 62, respiratory_rate: 14.2,
        source: "healthkit" as const,
      })),
      activity: WEEK_DATES.map((d, i) => ({
        local_date: d, steps: 8500 + i * 300, active_energy_kcal: 540, exercise_min: 32,
        source: "healthkit" as const,
      })),
      nutrition: WEEK_DATES.map((d, i) => ({
        local_date: d, calories_kcal: 2350, protein_g: i < 5 ? 150 : 110,
        carbs_g: 240, fat_g: 85, water_ml: null,
        source: "healthkit" as const, is_complete: true,
      })),
      body: [],
      workouts: [
        { sync_identifier: "w1", workout_type: "strength_training", start_at: "2026-06-30T22:00:00Z", end_at: "2026-06-30T23:00:00Z", duration_min: 60, active_kcal: 280, avg_hr: 121, distance_m: null, source: "healthkit" as const },
        { sync_identifier: "w2", workout_type: "running", start_at: "2026-07-02T11:00:00Z", end_at: "2026-07-02T11:40:00Z", duration_min: 40, active_kcal: 420, avg_hr: 156, distance_m: 6400, source: "healthkit" as const },
        { sync_identifier: "w3", workout_type: "strength_training", start_at: "2026-07-04T22:00:00Z", end_at: "2026-07-04T23:00:00Z", duration_min: 60, active_kcal: 275, avg_hr: 118, distance_m: null, source: "healthkit" as const },
      ],
      habits: [
        { name: "Vitamin D", kind: "supplement" as const, due_days: 7, done_days: 7, adherence_30d_pct: 93, adherence_week_pct: 100 },
        { name: "Morning walk", kind: "habit" as const, due_days: 5, done_days: 4, adherence_30d_pct: 78, adherence_week_pct: 80 },
      ],
      checkin: { week_start: "2026-06-29", energy: 4, soreness: 2, sleep_quality: 4 },
    },
    baselines: {
      hrv_60d_mean: 60, hrv_60d_sd: 8, rhr_60d_mean: 53, rhr_60d_sd: 3,
      sleep_60d_mean_min: 425, steps_28d_median: 8800,
      acute_load_7d: 160, chronic_load_28d: 150, baseline_days_available: 62,
    },
    findings: [],
    biomarkers: { new_panel: false, flags: [] },
    last_week: {
      coach_message: "Solid week. Focus: keep bedtime anchored before 11:30.",
      recommendations: [
        { category: "sleep", message: "In bed by 11:30 on weeknights", status: "acted" },
      ],
    },
  };
}

export function sparseWeek(): WeeklyData {
  const w = normalWeek();
  w.week.sleep = w.week.sleep.slice(0, 2);
  w.week.vitals = w.week.vitals.slice(0, 2);
  w.week.activity = w.week.activity.slice(0, 3);
  w.week.nutrition = [];
  w.week.workouts = [];
  w.week.checkin = null;
  w.findings = [{
    code: "logging_gap", domain: "data", severity: "attention",
    evidence: "Only 2 of 7 days have sleep/vitals data; nutrition has 0 days.",
  }];
  return w;
}

export function travelWeek(): WeeklyData {
  const w = normalWeek();
  w.findings = [{
    code: "timezone_change_detected", domain: "sleep_recovery", severity: "info",
    evidence: "Timezone shifted from America/New_York to Europe/London mid-week; bedtime consistency analysis suppressed.",
  }];
  return w;
}

export function firstWeek(): WeeklyData {
  const w = normalWeek();
  w.baselines = {
    hrv_60d_mean: null, hrv_60d_sd: null, rhr_60d_mean: null, rhr_60d_sd: null,
    sleep_60d_mean_min: null, steps_28d_median: null,
    acute_load_7d: 160, chronic_load_28d: null, baseline_days_available: 5,
  };
  w.last_week = { coach_message: null, recommendations: [] };
  return w;
}

export function biomarkerWeek(): WeeklyData {
  const w = normalWeek();
  w.biomarkers = {
    new_panel: true,
    flags: [
      { marker: "LDL-C", value: 128, unit: "mg/dL", ref_low: 0, ref_high: 99, out_of_range: true, drawn_on: "2026-06-27", trend: "rising" },
      { marker: "HbA1c", value: 5.2, unit: "%", ref_low: 4.0, ref_high: 5.6, out_of_range: false, drawn_on: "2026-06-27", trend: "stable" },
    ],
  };
  return w;
}

export function recoverySuppressedWeek(): WeeklyData {
  const w = normalWeek();
  w.week.vitals = WEEK_DATES.map((d) => ({
    local_date: d, resting_hr: 58, hrv_sdnn_ms: 48, respiratory_rate: 14.9,
    source: "healthkit" as const,
  }));
  w.baselines.acute_load_7d = 240;
  w.baselines.chronic_load_28d = 150;
  w.findings = [{
    code: "recovery_suppressed_load_high", domain: "sleep_recovery", severity: "priority",
    evidence: "HRV 7d avg 48ms is 1.5 SD below 60d baseline 60ms while RHR is elevated (58 vs 53) and acute:chronic load is 1.6.",
    metrics: { hrv_7d: 48, hrv_60d_mean: 60, rhr_7d: 58, load_ratio: 1.6 },
  }];
  return w;
}
