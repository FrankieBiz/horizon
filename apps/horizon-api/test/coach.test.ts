import { describe, expect, it } from "vitest";
import { composedPrompt, buildUserMessage } from "../src/coach/prompt.js";
import { scanText, scanSummaryText, checkBiomarkerPhrasing } from "../src/coach/denylist.js";
import { weeklyDataSchema, weeklySummarySchema } from "../src/coach/schemas.js";
import * as weeks from "./fixtures/weeks.js";

describe("prompt composition", () => {
  it("composes all 8 skill sections in order", () => {
    const { system } = composedPrompt();
    const anchors = [
      "Role: Horizon weekly health coach",
      "Domain: sleep & recovery",
      "Domain: nutrition",
      "Domain: exercise & training load",
      "Domain: habits & supplements",
      "Domain: biomarkers",
      "Recommendations & coach message (single authority)",
      "Safety self-check",
    ];
    let last = -1;
    for (const anchor of anchors) {
      const idx = system.indexOf(anchor);
      expect(idx, `missing section: ${anchor}`).toBeGreaterThan(-1);
      expect(idx, `out of order: ${anchor}`).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("derives a stable prompt_version hash", () => {
    const a = composedPrompt();
    const b = composedPrompt();
    expect(a.version).toBe(b.version);
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it("hard rules are present verbatim", () => {
    const { system } = composedPrompt();
    expect(system).toContain("never diagnose, treat, cure, or prevent");
    expect(system).toContain("Missing is missing");
    expect(system).toContain("reference range your lab provided");
  });

  it("user message embeds the WeeklyData JSON", () => {
    const msg = buildUserMessage(weeks.normalWeek());
    expect(msg).toContain('"week_start": "2026-06-29"');
    expect(msg).toContain('"hrv_60d_mean": 60');
  });
});

describe("fixture weeks validate against the WeeklyData schema", () => {
  for (const [name, make] of Object.entries(weeks)) {
    it(name, () => {
      expect(() => weeklyDataSchema.parse(make())).not.toThrow();
    });
  }
});

describe("deny-list scanner", () => {
  it("passes clean coaching language", () => {
    const clean = `Strong week. You averaged 7 hours 5 minutes of sleep and hit
    your protein target on 5 of 7 logged days. Your HRV of 62ms sits right at
    your 60-day baseline. This week: in bed by 11pm on weeknights, and keep the
    Tuesday strength session easy.`;
    expect(scanText(clean)).toHaveLength(0);
  });

  it.each([
    ["diagnosis_verb", "Your data may help diagnose sleep problems."],
    ["treatment_advice", "This should treat your fatigue."],
    ["prescription", "Consider a prescription for that."],
    ["you_have_condition", "Based on this trend, you may have prediabetes."],
    ["indicates_condition", "Your HbA1c indicates diabetes."],
    ["condition_risk_claim", "This lowers your risk of heart disease."],
    ["medication_advice", "You should increase your statin dose."],
    ["judgment_on_labs", "That is an alarming level on your lab result."],
    ["medical_substitute_claim", "With Horizon there is no need to see a doctor."],
  ])("catches %s", (rule, text) => {
    const violations = scanText(text);
    expect(violations.map((v) => v.rule)).toContain(rule);
  });

  it("requires mandated phrasing when out-of-range biomarkers are discussed", () => {
    const noPhrasing = checkBiomarkerPhrasing("Your LDL-C was 128 mg/dL this panel.", true);
    expect(noPhrasing).toHaveLength(1);
    const good = checkBiomarkerPhrasing(
      "Your LDL-C was outside the reference range your lab provided (128 vs 0-99). Worth discussing with your doctor.",
      true);
    expect(good).toHaveLength(0);
    expect(checkBiomarkerPhrasing("no biomarkers this week", false)).toHaveLength(0);
  });

  it("scans all user-facing parts together", () => {
    const violations = scanSummaryText({
      coachMessage: "Nice week overall.",
      recommendationTexts: ["Stop taking your medication dose on rest days."],
      observationTexts: [],
      hasOutOfRangeFlags: false,
    });
    expect(violations.map((v) => v.rule)).toContain("medication_advice");
  });
});

describe("WeeklySummary output schema", () => {
  const good = {
    domain_analyses: [{
      domain: "sleep_recovery",
      observations: ["Average sleep 7h05m, right at your 60-day baseline."],
      severity: "info",
      evidence: ["total_min avg 425 vs baseline 425"],
    }],
    wins: ["Protein target hit 5 of 7 days"],
    focus_areas: ["Bedtime consistency"],
    coach_message: "A genuinely solid week. You averaged 7h05m of sleep and hit protein on 5 of 7 days. Keep the 11pm bedtime going — that was last week's focus and you did it. This week: hold steady.",
    recommendations: [{
      category: "sleep", priority: 1,
      message: "Keep weeknight bedtime at 11pm.",
      rationale: "Bedtime consistency held HRV at baseline; protecting it protects recovery.",
    }],
    safety_self_check: {
      no_diagnosis_language: true,
      no_medication_or_dosage_advice: true,
      biomarker_phrasing_compliant: true,
      notes: "No medical language present.",
    },
  };

  it("accepts a compliant summary", () => {
    expect(() => weeklySummarySchema.parse(good)).not.toThrow();
  });

  it("rejects more than 3 recommendations", () => {
    const bad = { ...good, recommendations: Array(4).fill(good.recommendations[0]) };
    expect(() => weeklySummarySchema.parse(bad)).toThrow();
  });

  it("rejects unknown recommendation categories", () => {
    const bad = {
      ...good,
      recommendations: [{ ...good.recommendations[0], category: "medication" }],
    };
    expect(() => weeklySummarySchema.parse(bad)).toThrow();
  });

  it("rejects a summary missing the safety self-check", () => {
    const { safety_self_check: _, ...bad } = good as any;
    expect(() => weeklySummarySchema.parse(bad)).toThrow();
  });
});
