// The deterministic rules engine (prep spec §7, thresholds v1 — pinned
// 2026-07-07 Stage 0). Claude never computes; this file is the only place
// finding math lives. Pure functions: rows in, findings out.

import type { Finding } from "../coach/schemas.js";
import { clockTimeSdMinutes, mean, median, sd, sessionLoad, zScore } from "./baselines.js";

// ---- Thresholds v1 (spec §7). Change = new version, recorded in the spec. ----
export const THRESHOLDS = {
  bedtimeSdMin: 60,             // sleep_consistency_low
  sleepShortNights: 3,          // nights below need
  proteinFactor: 0.8,           // protein_adherence_low vs target
  proteinLowDays: 4,            // on ≥4 logged days
  loadRatioHigh: 1.3,           // acute:chronic
  hrvSuppressedSd: 1.0,         // HRV 7d below baseline by ≥1 SD
  stepsLowFactor: 0.7,          // steps < 70% of 28d median
  habitSlipPoints: 25,          // adherence drop vs 30d
  minDomainDays: 4,             // minimum days for findings to fire
  workoutGapWeeks: 2,           // re-engagement nudge
} as const;

export interface WeekRows {
  weekStart: string;
  timezone: string;
  sleepNeedMin: number;
  proteinTargetG: number | null;
  // Current week (7 days)
  sleep: Array<{ local_date: string; total_min: number; bedtime_at: string | null }>;
  vitals: Array<{ local_date: string; resting_hr: number | null; hrv_sdnn_ms: number | null }>;
  activity: Array<{ local_date: string; steps: number; exercise_min: number }>;
  nutrition: Array<{ local_date: string; calories_kcal: number | null; protein_g: number | null; is_complete: boolean }>;
  workouts: Array<{ start_at: string; duration_min: number; avg_hr: number | null }>;
  habits: Array<{ name: string; adherence_week_pct: number | null; adherence_30d_pct: number | null }>;
  timezones: string[]; // distinct habit-log/sync timezones seen this week
  // History (56 days before week start, for baselines)
  historyVitals: Array<{ local_date: string; resting_hr: number | null; hrv_sdnn_ms: number | null }>;
  historySleep: Array<{ local_date: string; total_min: number }>;
  historyActivity: Array<{ local_date: string; steps: number }>;
  historyWorkouts: Array<{ start_at: string; duration_min: number; avg_hr: number | null }>;
  weeksSinceLastWorkout: number | null;
}

export interface Baselines {
  hrv_60d_mean: number | null;
  hrv_60d_sd: number | null;
  rhr_60d_mean: number | null;
  rhr_60d_sd: number | null;
  sleep_60d_mean_min: number | null;
  steps_28d_median: number | null;
  acute_load_7d: number | null;
  chronic_load_28d: number | null;
  baseline_days_available: number;
}

export function computeBaselines(rows: WeekRows): Baselines {
  const hrvHist = rows.historyVitals.map((v) => v.hrv_sdnn_ms).filter((x): x is number => x != null);
  const rhrHist = rows.historyVitals.map((v) => v.resting_hr).filter((x): x is number => x != null);
  const acute = rows.workouts.reduce((acc, w) => acc + sessionLoad(w.duration_min, w.avg_hr), 0);
  const chronicWindow = rows.historyWorkouts.reduce(
    (acc, w) => acc + sessionLoad(w.duration_min, w.avg_hr), 0);
  // chronic = mean weekly load over the 4 history weeks (28d window supplied).
  const chronic = rows.historyWorkouts.length > 0 ? chronicWindow / 4 : null;

  return {
    hrv_60d_mean: mean(hrvHist),
    hrv_60d_sd: sd(hrvHist),
    rhr_60d_mean: mean(rhrHist),
    rhr_60d_sd: sd(rhrHist),
    sleep_60d_mean_min: mean(rows.historySleep.map((s) => s.total_min)),
    steps_28d_median: median(rows.historyActivity.slice(-28).map((a) => a.steps)),
    acute_load_7d: acute > 0 ? Math.round(acute) : rows.workouts.length === 0 ? 0 : null,
    chronic_load_28d: chronic != null ? Math.round(chronic) : null,
    baseline_days_available: rows.historyVitals.length,
  };
}

export function computeFindings(rows: WeekRows, baselines: Baselines): Finding[] {
  const findings: Finding[] = [];
  const T = THRESHOLDS;

  // ---- Data completeness first: gate everything else per domain ----
  const domainDays = {
    sleep: rows.sleep.length,
    vitals: rows.vitals.length,
    activity: rows.activity.length,
    nutrition: rows.nutrition.filter((n) => n.calories_kcal != null || n.protein_g != null).length,
  };
  const gaps = Object.entries(domainDays).filter(([, n]) => n < T.minDomainDays);
  if (gaps.length > 0) {
    findings.push({
      code: "logging_gap",
      domain: "data",
      severity: gaps.length >= 3 ? "attention" : "info",
      evidence: gaps.map(([d, n]) => `${d}: ${n}/7 days`).join(", "),
    });
  }

  // ---- Travel / timezone ----
  const travelWeek = rows.timezones.length > 1;
  if (travelWeek) {
    findings.push({
      code: "timezone_change_detected",
      domain: "sleep_recovery",
      severity: "info",
      evidence: `Multiple timezones this week (${rows.timezones.join(", ")}); bedtime consistency analysis suppressed.`,
    });
  }

  // ---- Sleep ----
  if (domainDays.sleep >= T.minDomainDays) {
    if (!travelWeek) {
      const bedtimes = rows.sleep
        .map((s) => s.bedtime_at).filter((b): b is string => b != null)
        .map((b) => new Date(b));
      const spread = clockTimeSdMinutes(bedtimes, rows.timezone);
      if (spread != null && spread > T.bedtimeSdMin) {
        findings.push({
          code: "sleep_consistency_low",
          domain: "sleep_recovery",
          severity: "attention",
          evidence: `Bedtime standard deviation ${Math.round(spread)} min this week (threshold ${T.bedtimeSdMin}).`,
          metrics: { bedtime_sd_min: Math.round(spread) },
        });
      }
    }
    const shortNights = rows.sleep.filter((s) => s.total_min < rows.sleepNeedMin).length;
    if (shortNights >= T.sleepShortNights) {
      const avg = Math.round(mean(rows.sleep.map((s) => s.total_min)) ?? 0);
      findings.push({
        code: "sleep_duration_short",
        domain: "sleep_recovery",
        severity: "attention",
        evidence: `${shortNights} of ${rows.sleep.length} nights below your ${rows.sleepNeedMin}-min need; average ${avg} min.`,
        metrics: { short_nights: shortNights, avg_sleep_min: avg },
      });
    }
  }

  // ---- Recovery x load ----
  const hrvWeek = rows.vitals.map((v) => v.hrv_sdnn_ms).filter((x): x is number => x != null);
  const rhrWeek = rows.vitals.map((v) => v.resting_hr).filter((x): x is number => x != null);
  const hrv7 = mean(hrvWeek);
  const rhr7 = mean(rhrWeek);
  const hrvZ = zScore(hrv7, baselines.hrv_60d_mean, baselines.hrv_60d_sd);
  const rhrZ = zScore(rhr7, baselines.rhr_60d_mean, baselines.rhr_60d_sd);
  const loadRatio =
    baselines.acute_load_7d != null && baselines.chronic_load_28d != null && baselines.chronic_load_28d > 0
      ? baselines.acute_load_7d / baselines.chronic_load_28d
      : null;
  const baselineReady = baselines.baseline_days_available >= 60;

  if (baselineReady && hrvZ != null && hrvZ <= -T.hrvSuppressedSd && (rhrZ ?? 0) > 0 && loadRatio != null && loadRatio > T.loadRatioHigh) {
    findings.push({
      code: "recovery_suppressed_load_high",
      domain: "sleep_recovery",
      severity: "priority",
      evidence: `HRV 7d avg ${hrv7!.toFixed(0)}ms is ${Math.abs(hrvZ).toFixed(1)} SD below your 60d baseline ${baselines.hrv_60d_mean!.toFixed(0)}ms, RHR elevated (${rhr7!.toFixed(0)} vs ${baselines.rhr_60d_mean!.toFixed(0)}), and acute:chronic load is ${loadRatio.toFixed(1)}.`,
      metrics: { hrv_7d: hrv7, hrv_z: hrvZ, rhr_7d: rhr7, load_ratio: loadRatio },
    });
  } else if (loadRatio != null && loadRatio > T.loadRatioHigh) {
    findings.push({
      code: "training_load_spike",
      domain: "exercise",
      severity: "info",
      evidence: `Acute:chronic training load ${loadRatio.toFixed(1)} (threshold ${T.loadRatioHigh}); recovery metrics ${baselineReady ? "look normal" : "can't be judged yet (baseline building)"}.`,
      metrics: { load_ratio: loadRatio },
    });
  }
  if (!baselineReady) {
    findings.push({
      code: "baseline_building",
      domain: "data",
      severity: "info",
      evidence: `${baselines.baseline_days_available} of 60 baseline days collected; deviation-based coaching unlocks at 60.`,
    });
  }

  // ---- Activity ----
  if (domainDays.activity >= T.minDomainDays && baselines.steps_28d_median != null) {
    const weekSteps = mean(rows.activity.map((a) => a.steps));
    if (weekSteps != null && weekSteps < baselines.steps_28d_median * T.stepsLowFactor) {
      const lows = [...rows.activity].sort((a, b) => a.steps - b.steps).slice(0, 2);
      findings.push({
        code: "activity_low_week",
        domain: "exercise",
        severity: "attention",
        evidence: `Average ${Math.round(weekSteps)} steps/day vs your 28d median ${Math.round(baselines.steps_28d_median)}; lowest days ${lows.map((l) => `${l.local_date} (${l.steps})`).join(" and ")}.`,
        metrics: { avg_steps: Math.round(weekSteps), median_28d: baselines.steps_28d_median },
      });
    }
  }
  if (rows.weeksSinceLastWorkout != null && rows.weeksSinceLastWorkout >= T.workoutGapWeeks) {
    findings.push({
      code: "workout_gap",
      domain: "exercise",
      severity: "info",
      evidence: `No workouts logged in ${rows.weeksSinceLastWorkout} weeks.`,
    });
  }

  // ---- Nutrition ----
  const loggedProtein = rows.nutrition.filter((n) => n.protein_g != null);
  if (rows.proteinTargetG != null && loggedProtein.length >= T.minDomainDays) {
    const lowDays = loggedProtein.filter((n) => n.protein_g! < rows.proteinTargetG! * T.proteinFactor);
    if (lowDays.length >= T.proteinLowDays) {
      const hitDays = loggedProtein.filter((n) => n.protein_g! >= rows.proteinTargetG!);
      findings.push({
        code: "protein_adherence_low",
        domain: "nutrition",
        severity: "attention",
        evidence: `Below ${Math.round(rows.proteinTargetG * T.proteinFactor)}g (0.8× your ${rows.proteinTargetG}g target) on ${lowDays.length} of ${loggedProtein.length} logged days${hitDays.length > 0 ? `; target hit on ${hitDays.map((d) => d.local_date).join(", ")}` : ""}.`,
        metrics: { low_days: lowDays.length, logged_days: loggedProtein.length },
      });
    }
  }
  const badSyncDays = rows.nutrition.filter((n) => n.calories_kcal != null && n.protein_g == null).length;
  if (badSyncDays >= 3) {
    findings.push({
      code: "nutrition_partial_sync",
      domain: "nutrition",
      severity: "info",
      evidence: `${badSyncDays} days have calories without macros — likely the food app isn't writing macros to Apple Health.`,
    });
  }

  // ---- Habits ----
  for (const h of rows.habits) {
    if (h.adherence_week_pct != null && h.adherence_30d_pct != null &&
        h.adherence_30d_pct - h.adherence_week_pct > T.habitSlipPoints) {
      findings.push({
        code: "habit_adherence_slipping",
        domain: "habits",
        severity: "info",
        evidence: `${h.name}: ${Math.round(h.adherence_week_pct)}% this week vs ${Math.round(h.adherence_30d_pct)}% over 30 days.`,
        metrics: { week_pct: h.adherence_week_pct, month_pct: h.adherence_30d_pct },
      });
    }
  }

  return findings;
}
