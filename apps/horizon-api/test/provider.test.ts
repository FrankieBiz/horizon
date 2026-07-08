import { describe, expect, it } from "vitest";
import { parseSummary } from "../src/coach/anthropic.js";
import type { WeeklySummary } from "../src/coach/schemas.js";

// DeepSeek has no structured-output guarantee, so parseSummary must recover a
// valid WeeklySummary from fenced / prose-wrapped model text. zod is the
// contract; these lock in the fence/prose stripping around it.

const valid: WeeklySummary = {
  domain_analyses: [{
    domain: "sleep_recovery",
    observations: ["Sleep averaged 7h5m, on your baseline."],
    severity: "info",
    evidence: ["avg total_min 425"],
  }],
  wins: ["Bedtime held all week"],
  focus_areas: ["Weekend protein"],
  coach_message: "Solid week — you averaged 7h5m of sleep and hit protein on 5 of 7 logged days. Keep the 11pm bedtime; this week, carry protein through the weekend.",
  recommendations: [{
    category: "nutrition", priority: 1,
    message: "Add a protein-forward weekend breakfast.",
    rationale: "Both protein misses were weekend days.",
  }],
  safety_self_check: {
    no_diagnosis_language: true,
    no_medication_or_dosage_advice: true,
    biomarker_phrasing_compliant: true,
    notes: "No medical language.",
  },
};
const json = JSON.stringify(valid);

describe("parseSummary (DeepSeek-tolerant)", () => {
  it("parses clean JSON", () => {
    expect(parseSummary(json)).toEqual(valid);
  });

  it("strips ```json fences", () => {
    expect(parseSummary("```json\n" + json + "\n```")).toEqual(valid);
  });

  it("strips bare ``` fences", () => {
    expect(parseSummary("```\n" + json + "\n```")).toEqual(valid);
  });

  it("strips leading/trailing prose around the object", () => {
    expect(parseSummary("Here is your review:\n\n" + json + "\n\nHope that helps!")).toEqual(valid);
  });

  it("still enforces the zod contract (bad shape throws)", () => {
    const tooMany = { ...valid, recommendations: Array(4).fill(valid.recommendations[0]) };
    expect(() => parseSummary(JSON.stringify(tooMany))).toThrow();
  });

  it("throws on non-JSON so the orchestrator records a failed run", () => {
    expect(() => parseSummary("I cannot help with that.")).toThrow();
  });
});
