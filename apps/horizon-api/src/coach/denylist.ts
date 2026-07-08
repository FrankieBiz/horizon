// Code-level safety backstop (prep spec §6 skill 8): deterministic scan of
// everything user-facing the model produced. Independent of the LLM's own
// self-check — this one cannot be sweet-talked.

export interface DenylistViolation {
  rule: string;
  match: string;
}

// Clinical terms AND lay/morphological variants (review finding: "high blood
// pressure", "prediabetic", "high cholesterol" evaded the clinical-only list).
const CONDITIONS =
  "(?:pre[- ]?diabet\\w+|diabet\\w+|hypertens\\w+|high blood pressure|cancer\\w*|arrhythmi\\w+|atrial fibrillation|afib|apnea|hypothyroid\\w*|hyperthyroid\\w*|(?:low|under[- ]?active|over[- ]?active) thyroid|anemi\\w+|depression|anxiety disorder|insomnia disorder|metabolic syndrome|insulin resistan\\w+|heart disease|cardiovascular disease|kidney disease|liver disease|fatty liver|hyperlipidemi\\w+|hypercholesterolemi\\w+|high cholesterol)";

const RULES: Array<{ rule: string; pattern: RegExp }> = [
  { rule: "diagnosis_verb", pattern: /\bdiagnos(?:e|es|ed|is|ing)\b/i },
  { rule: "cure_claim", pattern: /\bcur(?:e|es|ed|ing)\b(?!\s*iosity)/i },
  // "treat … as …" is legitimate framing language ("treat this as a rest
  // week") — exclude it so compliant reviews don't degrade to fallback.
  { rule: "treatment_advice", pattern: /\btreat(?:s|ed|ing)?\b(?!(?:\s+\w+){0,2}\s+as\b)|\btreatments?\b/i },
  { rule: "prescription", pattern: /\bprescri(?:be|bes|bed|bing|ption|ptions)\b/i },
  { rule: "you_have_condition", pattern: new RegExp(`\\byou(?:'re| are| have| may have| might have| likely have| may be| might be| appear to be| seem)\\b[^.!?]{0,60}${CONDITIONS}`, "i") },
  { rule: "indicates_condition", pattern: new RegExp(`\\b(?:indicat\\w*|suggest\\w*|is a sign of|points? to)\\b[^.!?]{0,60}${CONDITIONS}`, "i") },
  { rule: "condition_risk_claim", pattern: new RegExp(`\\b(?:risk|chance|likelihood) of\\b[^.!?]{0,40}${CONDITIONS}`, "i") },
  { rule: "medication_advice", pattern: /\b(?:start|stop|increase|decrease|adjust|taper|double|halve|skip)\b[^.!?]{0,40}\b(?:medication|meds|dose|dosage|statin|metformin|insulin)\b/i },
  // Supplement initiation/removal is forbidden coaching (spec §9) — logging
  // adherence is fine; telling the user to start/stop/take one is not.
  { rule: "supplement_advice", pattern: /\b(?:start|stop|add|begin|try|take|switch to)\b[^.!?]{0,40}\b(?:supplement|vitamin [a-z0-9]+|creatine|magnesium|melatonin|omega[- ]?3s?|fish oil|zinc|iron|ashwagandha|berberine|electrolytes?)\b/i },
  // Dose-change advice in either direction (verb→amount or amount→verb).
  { rule: "dosage_advice", pattern: /\b(?:increase|decrease|reduce|raise|lower|adjust|double|halve)\b[^.!?]{0,30}\b\d+ ?(?:mg|mcg|iu|g)\b|\b\d+ ?(?:mg|mcg|iu|g)\b[^.!?]{0,30}\b(?:instead|rather than|increase|reduce|up to|down to)\b/i },
  { rule: "judgment_on_labs", pattern: /\b(?:dangerous|alarming|worrying|abnormal)\b[^.!?]{0,50}\b(?:level|value|result|marker|lab)\b|\b(?:level|value|result|marker|lab)s?\b[^.!?]{0,50}\b(?:dangerous|alarming|worrying|abnormal)\b/i },
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
