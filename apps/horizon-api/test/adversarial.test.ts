import { describe, expect, it } from "vitest";
import { scanText, checkBiomarkerPhrasing, scanSummaryText } from "../src/coach/denylist.js";

// Stage-7 adversarial battery (prep spec Phase 7): seeded violations the
// filter MUST catch, plus legitimate coaching language it MUST pass.
// Philosophy: conservative — a false positive costs one fallback review; a
// false negative ships medical language. Bias to catching.

describe("adversarial: must catch", () => {
  it.each([
    // Case / phrasing variants of diagnosis
    "Your numbers DIAGNOSE a clear problem.",
    "This is diagnosing your condition remotely.",
    "These trends suggest hypothyroidism.",
    "Low HRV like yours points to metabolic syndrome.",
    "Your sleep pattern is a sign of insomnia disorder.",
    // Softened / hedged condition claims
    "You might have prediabetes based on this.",
    "You are developing hypertension.",
    // Risk-framing
    "Keeping this up reduces your chance of heart disease.",
    "This lowers the likelihood of cancer meaningfully.",
    // Medication / dosage
    "You could stop your metformin on low-carb days.",
    "Maybe double the dose on training days.",
    "Take 5000 IU instead of your current amount.",
    "It may be time to taper your meds.",
    // Lab judgment
    "That's a worrying value on your lab panel.",
    "Your LDL result is dangerous.",
    // Substituting for care
    "With trends like these there's no need to see a doctor.",
  ])("catches: %s", (text) => {
    expect(scanText(text).length, text).toBeGreaterThan(0);
  });

  it("catches violations buried inside otherwise-clean text", () => {
    const mixed = `Great consistency this week — your bedtime spread was only
    22 minutes. Protein averaged 148g. One note: your HRV trend indicates
    diabetes, so consider adjusting. Next week, keep the morning walks going.`;
    expect(scanText(mixed).map((v) => v.rule)).toContain("indicates_condition");
  });

  it("catches self-check bypass: violation only in a recommendation rationale", () => {
    const violations = scanSummaryText({
      coachMessage: "Clean message with numbers: 7h10m sleep average.",
      recommendationTexts: [
        "Walk 20 minutes daily.",
        "Because this will treat your insulin resistance over time.",
      ],
      observationTexts: [],
      hasOutOfRangeFlags: false,
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("requires doctor phrasing even when out-of-range value is mentioned positively", () => {
    const text = "Your ApoB came back at 110 mg/dL — higher than last time, keep an eye on it.";
    expect(checkBiomarkerPhrasing(text, true)).toHaveLength(1);
  });
});

describe("adversarial: lay-term and morphological variants (review findings)", () => {
  it.each([
    "your readings suggest you may have high blood pressure",
    "you're prediabetic based on these trends",
    "this points to high cholesterol",
    "you are developing insulin resistance",
    "this pattern suggests afib",
    "these values indicate fatty liver",
  ])("catches: %s", (text) => {
    expect(scanText(text).length, text).toBeGreaterThan(0);
  });

  it.each([
    "You should start taking creatine for recovery.",
    "Try adding a magnesium supplement before bed.",
    "Take vitamin D3 daily this winter.",
    "Stop the fish oil while training hard.",
  ])("catches supplement initiation advice: %s", (text) => {
    expect(scanText(text).length, text).toBeGreaterThan(0);
  });

  it.each([
    "Increase to 5000 IU on cloudy weeks.",
    "Reduce that to 200 mg in the evening.",
  ])("catches dose-change advice in either direction: %s", (text) => {
    expect(scanText(text).map((v) => v.rule), text).toContain("dosage_advice");
  });

  it("violation hidden in domain_analyses evidence is caught (backstop bypass fix)", () => {
    const violations = scanSummaryText({
      coachMessage: "Clean summary with your 7h12m sleep average.",
      recommendationTexts: ["Walk after dinner."],
      observationTexts: [
        "Sleep held steady all week.",           // observation — clean
        "HRV pattern indicates early-stage arrhythmia", // evidence — must be scanned
      ],
      hasOutOfRangeFlags: false,
    });
    expect(violations.map((v) => v.rule)).toContain("indicates_condition");
  });
});

describe("adversarial: must pass (no false positives on real coaching)", () => {
  it.each([
    // Everyday words containing banned stems must not fire via word boundaries
    "A weekend retreat helped your step count recover.",
    "Stay curious about what moves your numbers.",
    "Your bedtime crept later midweek — anchor it at 11pm.",
    // "treat … as …" framing is legitimate coaching language
    "Treat this as a rest week and keep the walks easy.",
    "Treat missing days as gaps, not failures.",
    // Adherence commentary on the user's OWN supplements is fine
    "You logged your Vitamin D on 6 of 7 scheduled days.",
    // Legitimate wellness language
    "Your HRV of 58ms is 1.2 SD below your own 60-day baseline.",
    "Swap one hard session for an easy walk and recheck next week.",
    "You hit your protein target on 5 of 7 logged days.",
    "Worth checking in with a healthcare provider if this pattern continues.",
    // Mandated biomarker phrasing itself must pass
    "Your LDL-C was outside the reference range your lab provided (128 vs 0–99). That's worth discussing with your doctor — this app can't interpret lab results.",
  ])("passes: %s", (text) => {
    expect(scanText(text), text).toHaveLength(0);
  });

  it("mandated phrasing satisfies the biomarker check", () => {
    const text = "Your LDL-C was outside the reference range your lab provided. Discuss it with your doctor.";
    expect(checkBiomarkerPhrasing(text, true)).toHaveLength(0);
  });
});
