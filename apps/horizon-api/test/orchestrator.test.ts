import { describe, expect, it } from "vitest";
import { buildFallbackMessage, makeWeeklyRunnerWithDeps, previousWeekStart } from "../src/coach/run.js";
import { zonedMidnightUtc } from "../src/coach/assemble.js";
import { structuredOutputSchema } from "../src/coach/anthropic.js";
import type { GenerateResult } from "../src/coach/anthropic.js";
import type { WeeklySummary } from "../src/coach/schemas.js";
import { scanText } from "../src/coach/denylist.js";
import { TEST_USER } from "./helpers.js";
import * as weeks from "./fixtures/weeks.js";

// A db fake smart enough for the orchestrator: routes queries by table.
class RoutedDb {
  calls: Array<{ text: string; params?: unknown[] }> = [];
  coachRunStatus: string | undefined;
  storedSummaries: unknown[][] = [];
  storedRecs: unknown[][] = [];
  runUpdates: Array<{ text: string; params?: unknown[] }> = [];
  weekRows: Record<string, any[]> = {};

  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    const t = text.replace(/\s+/g, " ");
    if (t.includes("from profiles") && t.includes("select user_id")) {
      return { rows: [{ user_id: TEST_USER, timezone: "America/New_York" }], rowCount: 1 };
    }
    if (t.includes("select timezone, goals_json")) {
      return { rows: [{ timezone: "America/New_York", goals_json: { sleep_need_min: 450, protein_target_g: 140, primary_goal: "longevity" } }], rowCount: 1 };
    }
    if (t.includes("select status from coach_runs")) {
      return { rows: this.coachRunStatus ? [{ status: this.coachRunStatus }] : [], rowCount: this.coachRunStatus ? 1 : 0 };
    }
    if (t.startsWith("insert into coach_runs")) return { rows: [], rowCount: 1 };
    if (t.startsWith("update coach_runs")) {
      this.runUpdates.push({ text: t, params });
      return { rows: [], rowCount: 1 };
    }
    if (t.startsWith("insert into weekly_summaries")) {
      this.storedSummaries.push(params ?? []);
      return { rows: [{ id: "sum-1" }], rowCount: 1 };
    }
    if (t.startsWith("delete from recommendations")) return { rows: [], rowCount: 0 };
    if (t.startsWith("insert into recommendations")) {
      this.storedRecs.push(params ?? []);
      return { rows: [], rowCount: 1 };
    }
    for (const [key, rows] of Object.entries(this.weekRows)) {
      if (t.includes(key)) return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  }
}

function seededDb(): RoutedDb {
  const db = new RoutedDb();
  const fixture = weeks.normalWeek();
  db.weekRows = {
    "from sleep_daily where user_id = $1 and local_date between": fixture.week.sleep,
    "from vitals_daily where user_id = $1 and local_date between": fixture.week.vitals,
    "from activity_daily where user_id = $1 and local_date between": fixture.week.activity,
    "from nutrition_daily where user_id = $1 and local_date between": fixture.week.nutrition,
    "from body_metrics": [],
    "from workouts where user_id = $1 and start_at >= $2::timestamptz and start_at < $3::timestamptz order by start_at": fixture.week.workouts,
    "from habit_logs where user_id = $1 and local_date between": [],
    "from vitals_daily where user_id = $1 and local_date >=": Array.from({ length: 60 }, (_, i) => ({ local_date: `h${i}`, resting_hr: 53, hrv_sdnn_ms: 60 })),
    "from sleep_daily where user_id = $1 and local_date >=": Array.from({ length: 60 }, () => ({ local_date: "h", total_min: 440 })),
    "from activity_daily where user_id = $1 and local_date >=": Array.from({ length: 28 }, () => ({ local_date: "h", steps: 9000 })),
    "select start_at, duration_min, avg_hr from workouts": Array.from({ length: 8 }, (_, i) => ({ start_at: `2026-06-${String(2 + i * 3).padStart(2, "0")}T22:00:00Z`, duration_min: 50, avg_hr: 130 })),
    "select max(start_at) as last": [{ last: "2026-07-04T22:00:00Z" }],
    "from habits h": [],
    "from habit_logs": [],
    "from weekly_checkins": [],
    "from weekly_summaries where user_id = $1 and week_start <": [],
    "from biomarker_panels": [{ n: 0 }],
    "from biomarker_results": [],
  };
  return db;
}

const goodSummary: WeeklySummary = {
  domain_analyses: [{
    domain: "sleep_recovery",
    observations: ["Sleep averaged above your need all week."],
    severity: "info",
    evidence: ["avg total_min 428"],
  }],
  wins: ["Consistent bedtimes all seven nights"],
  focus_areas: ["Protein on weekend days"],
  coach_message: "A genuinely strong week. You slept an average of 7 hours 8 minutes and your HRV of 62ms sat right on your 60-day baseline of 60ms. You kept last week's bedtime focus. This week: carry protein through the weekend — you hit 150g on weekdays but dropped to 110g on both weekend days.",
  recommendations: [{
    category: "nutrition", priority: 1,
    message: "Prep a protein-forward weekend breakfast so Saturday and Sunday match your weekday 150g.",
    rationale: "Protein hit target on 5 of 7 logged days; both misses were weekend days.",
  }],
  safety_self_check: {
    no_diagnosis_language: true,
    no_medication_or_dosage_advice: true,
    biomarker_phrasing_compliant: true,
    notes: "Checked: no medical language.",
  },
};

const badSummary: WeeklySummary = {
  ...goodSummary,
  coach_message: "Your HRV trend indicates diabetes risk, so you should increase your statin dose.",
};

function generator(script: WeeklySummary[]): { calls: string[]; generate: (s: string, u: string) => Promise<GenerateResult> } {
  const calls: string[] = [];
  return {
    calls,
    generate: async (_system, userMessage) => {
      calls.push(userMessage);
      const summary = script[Math.min(calls.length - 1, script.length - 1)]!;
      return { summary, tokensIn: 8000, tokensOut: 1500, costUsd: 0.0775, model: "claude-opus-4-8" };
    },
  };
}

describe("previousWeekStart", () => {
  it("on a Monday returns the prior Monday (the week that just ended)", () => {
    // 2026-07-06 is a Monday.
    expect(previousWeekStart(new Date("2026-07-06T12:00:00Z"), "America/New_York")).toBe("2026-06-29");
  });
  it("mid-week still returns the current-week's prior Monday", () => {
    expect(previousWeekStart(new Date("2026-07-09T12:00:00Z"), "America/New_York")).toBe("2026-06-29");
  });
  it("respects the timezone at day boundaries", () => {
    // 2026-07-06 01:00 UTC is still Sunday 2026-07-05 in New York →
    // the week that ended is the one starting 2026-06-22.
    expect(previousWeekStart(new Date("2026-07-06T01:00:00Z"), "America/New_York")).toBe("2026-06-22");
    expect(previousWeekStart(new Date("2026-07-06T01:00:00Z"), "UTC")).toBe("2026-06-29");
  });
});

describe("weekly orchestrator", () => {
  it("happy path: assembles, generates, stores, notifies, records the run", async () => {
    const db = seededDb();
    const gen = generator([goodSummary]);
    const notified: string[] = [];
    const run = makeWeeklyRunnerWithDeps({
      db, generate: gen.generate,
      notify: async (u, w) => { notified.push(`${u}:${w}`); },
      now: () => new Date("2026-07-06T12:00:00Z"),
    });
    const results = await run();
    expect(results).toEqual([{ userId: TEST_USER, weekStart: "2026-06-29", status: "succeeded" }]);
    expect(gen.calls).toHaveLength(1);
    expect(gen.calls[0]).toContain('"week_start": "2026-06-29"');
    expect(db.storedSummaries).toHaveLength(1);
    expect(db.storedRecs).toHaveLength(1);
    expect(notified).toEqual([`${TEST_USER}:2026-06-29`]);
    const succeeded = db.runUpdates.find((u) => u.text.includes("'succeeded'"));
    expect(succeeded).toBeDefined();
    expect(succeeded!.params).toContain(8000);
    // Guard: the history window must satisfy the >=60-day baseline gate
    // (review finding: a 56-day window silently killed the recovery pathway).
    expect(db.calls.some((c) => c.text.includes("interval '60 days'"))).toBe(true);
    // Guard: workout windows are local-week timestamptz bounds, not date casts.
    const workoutCall = db.calls.find((c) =>
      c.text.includes("from workouts where user_id = $1 and start_at >= $2::timestamptz"));
    expect(workoutCall).toBeDefined();
    expect(workoutCall!.params![1]).toBe("2026-06-29T04:00:00.000Z"); // EDT midnight
  });

  it("zonedMidnightUtc converts local midnight to the right instant (DST both sides)", () => {
    expect(zonedMidnightUtc("2026-07-06", "America/New_York").toISOString())
      .toBe("2026-07-06T04:00:00.000Z"); // EDT
    expect(zonedMidnightUtc("2026-01-05", "America/New_York").toISOString())
      .toBe("2026-01-05T05:00:00.000Z"); // EST
    expect(zonedMidnightUtc("2026-07-06", "UTC").toISOString())
      .toBe("2026-07-06T00:00:00.000Z");
  });

  it("skips a week that already succeeded (idempotent reruns)", async () => {
    const db = seededDb();
    db.coachRunStatus = "succeeded";
    const gen = generator([goodSummary]);
    const run = makeWeeklyRunnerWithDeps({
      db, generate: gen.generate, now: () => new Date("2026-07-06T12:00:00Z"),
    });
    const results = await run();
    expect(results[0]!.status).toBe("skipped");
    expect(gen.calls).toHaveLength(0);
    expect(db.storedSummaries).toHaveLength(0);
  });

  it("retries once on denylist violations, then succeeds", async () => {
    const db = seededDb();
    const gen = generator([badSummary, goodSummary]);
    const run = makeWeeklyRunnerWithDeps({
      db, generate: gen.generate, now: () => new Date("2026-07-06T12:00:00Z"),
    });
    const results = await run();
    expect(results[0]!.status).toBe("succeeded");
    expect(gen.calls).toHaveLength(2);
    expect(gen.calls[1]).toContain("violated these safety rules");
    expect(gen.calls[1]).toContain("indicates_condition");
  });

  it("catches a violation hidden ONLY in domain_analyses evidence (backstop fix)", async () => {
    const evidenceBypass: WeeklySummary = {
      ...goodSummary,
      domain_analyses: [{
        domain: "sleep_recovery",
        observations: ["Sleep steady all week."],
        severity: "info",
        evidence: ["HRV pattern indicates early-stage arrhythmia"],
      }],
    };
    const db = seededDb();
    const gen = generator([evidenceBypass, goodSummary]);
    const run = makeWeeklyRunnerWithDeps({
      db, generate: gen.generate, now: () => new Date("2026-07-06T12:00:00Z"),
    });
    const results = await run();
    // Draft 1 must be rejected (evidence scanned), draft 2 accepted.
    expect(gen.calls).toHaveLength(2);
    expect(gen.calls[1]).toContain("indicates_condition");
    expect(results[0]!.status).toBe("succeeded");
  });

  it("falls back to metrics-only after two violating drafts", async () => {
    const db = seededDb();
    const gen = generator([badSummary, badSummary]);
    const run = makeWeeklyRunnerWithDeps({
      db, generate: gen.generate, now: () => new Date("2026-07-06T12:00:00Z"),
    });
    const results = await run();
    expect(results[0]!.status).toBe("fallback");
    // The stored coach_message is the deterministic fallback, not model prose.
    const stored = db.storedSummaries[0]!;
    expect(String(stored[4])).toContain("Your weekly data summary:");
    const fallbackUpdate = db.runUpdates.find((u) => u.text.includes("'fallback'"));
    expect(fallbackUpdate).toBeDefined();
  });

  it("a per-user failure doesn't crash the run and is recorded", async () => {
    const db = seededDb();
    const run = makeWeeklyRunnerWithDeps({
      db,
      generate: async () => { throw new Error("api unreachable"); },
      now: () => new Date("2026-07-06T12:00:00Z"),
    });
    const results = await run();
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.error).toBe("api unreachable");
    const failed = db.runUpdates.find((u) => u.text.includes("'failed'"));
    expect(failed).toBeDefined();
  });
});

describe("fallback message", () => {
  it("is deterministic, numeric, and denylist-clean", () => {
    const msg = buildFallbackMessage(weeks.normalWeek());
    expect(msg).toContain("Sleep: 7 nights recorded");
    expect(msg).toContain("Workouts: 3 sessions logged");
    expect(scanText(msg)).toHaveLength(0);
  });
});

describe("structured output schema", () => {
  it("strips constraint keywords the API rejects and closes objects", () => {
    const schema = structuredOutputSchema() as any;
    const json = JSON.stringify(schema);
    expect(json).not.toContain("minLength");
    expect(json).not.toContain("maxItems");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("safety_self_check");
    expect(schema.properties.recommendations.items.properties.category.enum)
      .toContain("recovery");
  });
});
