// Code-level safety backstop (prep spec §6 skill 8): deterministic scan of
// everything user-facing the model produced. Independent of the LLM's own
// self-check — this one cannot be sweet-talked.

export interface DenylistViolation {
  rule: string;
  match: string;
}

const CONDITIONS =
  "(?:diabetes|prediabetes|hypertension|cancer|arrhythmia|apnea|hypothyroid\\w*|hyperthyroid\\w*|anemia|depression|anxiety disorder|insomnia disorder|metabolic syndrome|heart disease|kidney disease|liver disease|hyperlipidemia|hypercholesterolemia)";

const RULES: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "diagnosis_verb", pattern: /\bdiagnos(?:e|es|ed|is|ing)\b/i },
  { rule: "cure_claim", pattern: /\bcur(?:e|es|ed|ing)\b(?!\s*iosity)/i },
  { rule: "treatment_advice", pattern: /\btreat(?:s|ed|ing|ment|ments)?\b/i },
  { rule: "prescription", pattern: /\bprescri(?:be|bes|bed|bing|ption|ptions)\b/i },
  { rule: "you_have_condition", pattern: new RegExp(`\\byou (?:have|may have|might have|likely have|are developing)\\b[^.!?]{0,60}${CONDITIONS}`, "i") },
  { rule: "indicates_condition", pattern: new RegExp(`\\b(?:indicat\\w+|suggest\\w+|is a sign of|points? to)\\b[^.!?]{0,60}${CONDITIONS}`, "i") },
  { rule: "condition_risk_claim", pattern: new RegExp(`\\b(?:risk|chance|likelihood) of\\b[^.!?]{0,40}${CONDITIONS}`, "i") },
  { rule: "medication_advice", pattern: /\b(?:start|stop|increase|decrease|adjust|taper|double|halve|skip)\b[^.!?]{0,40}\b(?:medication|meds|dose|dosage|statin|metformin|insulin)\b/i },
  { rule: "dosage_advice", pattern: /\b(?:mg|mcg|iu)\b[^.!?]{0,30}\b(?:instead|rather than|increase to|reduce to|up to)\b/i },
  { rule: "judgment_on_labs", pattern: /\b(?:dangerous|alarming|worrying|abnormal)\b[^.!?]{0,50}\b(?:level|value|result|marker|lab)\b/i },
  { rule: "medical_substitute_claim", pattern: /\b(?:no need to see|instead of seeing|replaces?|skip)\b[^.!?]{0,30}\b(?:doctor|physician|medical)\b/i },
];

/** Scan user-facing text; returns every rule violation found. */
export function scanText(text: string): DenylistViolation[] {
  const violations: DenylistViolation[] = [];
  for (const { rule, pattern } of RULES) {
    const match = text.match(pattern);
    if (match) violations.push({ rule, match: match[0] });
  }
  return violations;
}

/**
 * Biomarker content carries an extra requirement: the mandated phrasing must
 * be present (reference range + doctor referral) whenever out-of-range values
 * are discussed.
 */
export function checkBiomarkerPhrasing(text: string, hasOutOfRangeFlags: boolean): DenylistViolation[] {
  if (!hasOutOfRangeFlags) return [];
  const mentionsRange = /reference range/i.test(text);
  const mentionsDoctor = /\bdoctor\b|\bclinician\b|\bhealthcare provider\b/i.test(text);
  if (mentionsRange && mentionsDoctor) return [];
  return [{
    rule: "biomarker_mandated_phrasing_missing",
    match: "out-of-range biomarker discussed without reference-range + doctor phrasing",
  }];
}

/** Everything user-facing in one pass. */
export function scanSummaryText(parts: {
  coachMessage: string;
  recommendationTexts: string[];
  observationTexts: string[];
  hasOutOfRangeFlags: boolean;
}): DenylistViolation[] {
  const joined = [
    parts.coachMessage,
    ...parts.recommendationTexts,
    ...parts.observationTexts,
  ].join("\n");
  return [
    ...scanText(joined),
    ...checkBiomarkerPhrasing(joined, parts.hasOutOfRangeFlags),
  ];
}
