import { describe, expect, it } from "vitest";
import { clockTimeSdMinutes, mean, median, sd, sessionLoad, zScore } from "../src/analysis/baselines.js";
import { computeBaselines, computeFindings, THRESHOLDS, type WeekRows } from "../src/analysis/findings.js";

const TZ = "America/New_York";

function baseRows(): WeekRows {
  const dates = ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"];
  return {
    weekStart: "2026-06-29",
    timezone: TZ,
    sleepNeedMin: 450,
    proteinTargetG: 140,
    sleep: dates.map((d) => ({
      local_date: d, total_min: 460,
      bedtime_at: `${d}T03:05:00Z`, // 23:05 EDT — tight consistency
    })),
    vitals: dates.map((d) => ({ local_date: d, resting_hr: 52, hrv_sdnn_ms: 61 })),
    activity: dates.map((d) => ({ local_date: d, steps: 9000, exercise_min: 30 })),
    nutrition: dates.map((d) => ({ local_date: d, calories_kcal: 2300, protein_g: 150, is_complete: true })),
    workouts: [
      { start_at: "2026-06-30T22:00:00Z", duration_min: 60, avg_hr: 120 },
      { start_at: "2026-07-02T22:00:00Z", duration_min: 45, avg_hr: 150 },
    ],
    habits: [{ name: "Vitamin D", adherence_week_pct: 100, adherence_30d_pct: 95 }],
    timezones: [TZ],
    historyVitals: Array.from({ length: 60 }, (_, i) => ({
      local_date: `h${i}`, resting_hr: 52 + (i % 3), hrv_sdnn_ms: 58 + (i % 7),
    })),
    historySleep: Array.from({ length: 60 }, () => ({ local_date: "h", total_min: 445 })),
    historyActivity: Array.from({ length: 28 }, () => ({ local_date: "h", steps: 9200 })),
    historyWorkouts: Array.from({ length: 8 }, (_, i) => ({
      start_at: `2026-06-${String(i * 3 + 1).padStart(2, "0")}T22:00:00Z`,
      duration_min: 50, avg_hr: 130,
    })),
    weeksSinceLastWorkout: 0,
  };
}

describe("baseline math", () => {
  it("mean/sd/median handle empties and singletons", () => {
    expect(mean([])).toBeNull();
    expect(sd([5])).toBeNull();
    expect(median([])).toBeNull();
    expect(mean([2, 4])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])!).toBeCloseTo(2.138, 2);
  });

  it("zScore returns null without a usable baseline", () => {
    expect(zScore(50, null, 5)).toBeNull();
    expect(zScore(50, 60, 0)).toBeNull();
    expect(zScore(50, 60, 5)).toBe(-2);
  });

  it("clock-time SD is circular-safe around midnight", () => {
    // 23:30 and 00:30 local are 60 minutes apart, not ~23 hours.
    const instants = [
      new Date("2026-07-01T03:30:00Z"), // 23:30 EDT June 30
      new Date("2026-07-01T04:30:00Z"), // 00:30 EDT July 1
    ];
    const spread = clockTimeSdMinutes(instants, TZ)!;
    expect(spread).toBeLessThan(60); // sd of [690, 750] ≈ 42.4
    expect(spread).toBeGreaterThan(30);
  });

  it("sessionLoad scales duration by HR-derived intensity within clamps", () => {
    expect(sessionLoad(60, null)).toBe(60);
    expect(sessionLoad(60, 120)).toBe(60);
    expect(sessionLoad(60, 180)).toBe(90);
    expect(sessionLoad(60, 40)).toBe(36); // clamp at 0.6
  });
});

describe("computeBaselines", () => {
  it("computes personal baselines from history", () => {
    const b = computeBaselines(baseRows());
    expect(b.hrv_60d_mean).toBeGreaterThan(58);
    expect(b.hrv_60d_sd).toBeGreaterThan(0);
    expect(b.steps_28d_median).toBe(9200);
    expect(b.baseline_days_available).toBe(60);
    expect(b.acute_load_7d).toBeGreaterThan(0);
    expect(b.chronic_load_28d).toBeGreaterThan(0);
  });
});

describe("findings v1 thresholds", () => {
  it("clean week produces no findings", () => {
    const rows = baseRows();
    const findings = computeFindings(rows, computeBaselines(rows));
    expect(findings).toHaveLength(0);
  });

  it("fires sleep_consistency_low when bedtime SD > 60min", () => {
    const rows = baseRows();
    // Alternate 21:30 and 01:00 EDT bedtimes — huge spread.
    rows.sleep = rows.sleep.map((s, i) => ({
      ...s, bedtime_at: i % 2 === 0 ? `${s.local_date}T01:30:00Z` : `${s.local_date}T05:00:00Z`,
    }));
    const codes = computeFindings(rows, computeBaselines(rows)).map((f) => f.code);
    expect(codes).toContain("sleep_consistency_low");
  });

  it("suppresses consistency finding on travel weeks", () => {
    const rows = baseRows();
    rows.sleep = rows.sleep.map((s, i) => ({
      ...s, bedtime_at: i % 2 === 0 ? `${s.local_date}T01:30:00Z` : `${s.local_date}T05:00:00Z`,
    }));
    rows.timezones = [TZ, "Europe/London"];
    const codes = computeFindings(rows, computeBaselines(rows)).map((f) => f.code);
    expect(codes).not.toContain("sleep_consistency_low");
    expect(codes).toContain("timezone_change_detected");
  });

  it("fires recovery_suppressed_load_high only with all three signals", () => {
    const rows = baseRows();
    // Suppressed HRV, elevated RHR this week…
    rows.vitals = rows.vitals.map((v) => ({ ...v, hrv_sdnn_ms: 45, resting_hr: 58 }));
    // …and a load spike: long hard sessions this week vs modest history.
    rows.workouts = [
      { start_at: "2026-06-29T22:00:00Z", duration_min: 90, avg_hr: 160 },
      { start_at: "2026-07-01T22:00:00Z", duration_min: 90, avg_hr: 160 },
      { start_at: "2026-07-03T22:00:00Z", duration_min: 90, avg_hr: 160 },
    ];
    const findings = computeFindings(rows, computeBaselines(rows));
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("recovery_suppressed_load_high");
    const f = findings.find((x) => x.code === "recovery_suppressed_load_high")!;
    expect(f.severity).toBe("priority");
    expect(f.evidence).toMatch(/HRV 7d avg 45ms/);
  });

  it("load spike without recovery suppression stays informational", () => {
    const rows = baseRows();
    rows.workouts = [
      { start_at: "2026-06-29T22:00:00Z", duration_min: 90, avg_hr: 160 },
      { start_at: "2026-07-01T22:00:00Z", duration_min: 90, avg_hr: 160 },
      { start_at: "2026-07-03T22:00:00Z", duration_min: 90, avg_hr: 160 },
    ];
    const findings = computeFindings(rows, computeBaselines(rows));
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("training_load_spike");
    expect(codes).not.toContain("recovery_suppressed_load_high");
  });

  it("withholds deviation findings while baseline is building", () => {
    const rows = baseRows();
    rows.historyVitals = rows.historyVitals.slice(0, 20); // only 20 days
    rows.vitals = rows.vitals.map((v) => ({ ...v, hrv_sdnn_ms: 40, resting_hr: 60 }));
    rows.workouts = [
      { start_at: "2026-06-29T22:00:00Z", duration_min: 90, avg_hr: 160 },
      { start_at: "2026-07-01T22:00:00Z", duration_min: 90, avg_hr: 160 },
      { start_at: "2026-07-03T22:00:00Z", duration_min: 90, avg_hr: 160 },
    ];
    const codes = computeFindings(rows, computeBaselines(rows)).map((f) => f.code);
    expect(codes).not.toContain("recovery_suppressed_load_high");
    expect(codes).toContain("baseline_building");
  });

  it("fires protein_adherence_low with hit-day pattern in evidence", () => {
    const rows = baseRows();
    rows.nutrition = rows.nutrition.map((n, i) => ({
      ...n, protein_g: i < 5 ? 90 : 150, // 5 low days, 2 hits
    }));
    const findings = computeFindings(rows, computeBaselines(rows));
    const f = findings.find((x) => x.code === "protein_adherence_low");
    expect(f).toBeDefined();
    expect(f!.evidence).toContain("112g (0.8× your 140g target)");
    expect(f!.evidence).toContain("2026-07-04");
  });

  it("missing days don't count as zeros (no protein finding on 3 logged days)", () => {
    const rows = baseRows();
    rows.nutrition = rows.nutrition.slice(0, 3).map((n) => ({ ...n, protein_g: 80 }));
    const codes = computeFindings(rows, computeBaselines(rows)).map((f) => f.code);
    expect(codes).not.toContain("protein_adherence_low");
    expect(codes).toContain("logging_gap");
  });

  it("flags partial nutrition syncs (calories without macros)", () => {
    const rows = baseRows();
    rows.nutrition = rows.nutrition.map((n) => ({ ...n, protein_g: null }));
    const codes = computeFindings(rows, computeBaselines(rows)).map((f) => f.code);
    expect(codes).toContain("nutrition_partial_sync");
  });

  it("fires activity_low_week with the two lowest days named", () => {
    const rows = baseRows();
    rows.activity = rows.activity.map((a, i) => ({ ...a, steps: i < 2 ? 1500 : 5000 }));
    const findings = computeFindings(rows, computeBaselines(rows));
    const f = findings.find((x) => x.code === "activity_low_week");
    expect(f).toBeDefined();
    expect(f!.evidence).toContain("2026-06-29 (1500)");
  });

  it("fires habit_adherence_slipping past 25-point drop", () => {
    const rows = baseRows();
    rows.habits = [{ name: "Vitamin D", adherence_week_pct: 43, adherence_30d_pct: 90 }];
    const findings = computeFindings(rows, computeBaselines(rows));
    const f = findings.find((x) => x.code === "habit_adherence_slipping");
    expect(f).toBeDefined();
    expect(f!.evidence).toContain("Vitamin D: 43% this week vs 90%");
  });

  it("no load-spike fabrication for users with shallow workout history", () => {
    // Review finding: a fixed /4 divisor turned 5 days of history into a
    // phantom 4.0 acute:chronic ratio. Shallow history → chronic null → no
    // load findings at all.
    const rows = baseRows();
    rows.historyWorkouts = [
      { start_at: "2026-06-26T22:00:00Z", duration_min: 60, avg_hr: 130 },
      { start_at: "2026-06-27T22:00:00Z", duration_min: 60, avg_hr: 130 },
    ]; // only 3 days before weekStart
    rows.workouts = [
      { start_at: "2026-06-29T22:00:00Z", duration_min: 90, avg_hr: 160 },
      { start_at: "2026-07-01T22:00:00Z", duration_min: 90, avg_hr: 160 },
      { start_at: "2026-07-03T22:00:00Z", duration_min: 90, avg_hr: 160 },
    ];
    const baselines = computeBaselines(rows);
    expect(baselines.chronic_load_28d).toBeNull();
    const codes = computeFindings(rows, baselines).map((f) => f.code);
    expect(codes).not.toContain("training_load_spike");
    expect(codes).not.toContain("recovery_suppressed_load_high");
  });

  it("thresholds v1 are the pinned spec values", () => {
    expect(THRESHOLDS.bedtimeSdMin).toBe(60);
    expect(THRESHOLDS.proteinFactor).toBe(0.8);
    expect(THRESHOLDS.loadRatioHigh).toBe(1.3);
    expect(THRESHOLDS.stepsLowFactor).toBe(0.7);
    expect(THRESHOLDS.habitSlipPoints).toBe(25);
    expect(THRESHOLDS.minDomainDays).toBe(4);
  });
});
