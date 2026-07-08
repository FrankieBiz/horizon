import { createHash } from "node:crypto";
import type { Queryable } from "../db/pool.js";
import { assembleWeeklyData } from "./assemble.js";
import { buildUserMessage, composedPrompt } from "./prompt.js";
import { scanSummaryText, type DenylistViolation } from "./denylist.js";
import type { SummaryGenerator } from "./anthropic.js";
import type { WeeklyData, WeeklySummary } from "./schemas.js";

export interface WeeklyRunResult {
  userId: string;
  weekStart: string;
  status: "succeeded" | "failed" | "fallback" | "skipped";
  error?: string;
}

export type WeeklyRunner = (weekStart?: string) => Promise<WeeklyRunResult[]>;

export interface RunnerDeps {
  db: Queryable;
  generate: SummaryGenerator;
  /** Stage 6 wires APNs here; default no-op. */
  notify?: (userId: string, weekStart: string) => Promise<void>;
  now?: () => Date;
}

/** Monday (yyyy-MM-dd) of the week that just ENDED in the user's timezone —
 * the cron fires Monday morning and reviews the previous Mon–Sun. */
export function previousWeekStart(now: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = get("weekday"); // Mon, Tue, ...
  const dayIndexFromMonday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  const todayUtcNoon = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")), 12);
  const monday = new Date(todayUtcNoon - (dayIndexFromMonday + 7) * 86400e3);
  return monday.toISOString().slice(0, 10);
}

/** Deterministic metrics-only fallback — delivered when the model can't
 * produce compliant prose twice. Numbers only, no generated language. */
export function buildFallbackMessage(data: WeeklyData): string {
  const lines: string[] = ["Your weekly data summary:"];
  const sleep = data.week.sleep;
  if (sleep.length > 0) {
    const avg = Math.round(sleep.reduce((a, s) => a + s.total_min, 0) / sleep.length);
    lines.push(`- Sleep: ${sleep.length} nights recorded, average ${Math.floor(avg / 60)}h ${avg % 60}m.`);
  }
  const act = data.week.activity;
  if (act.length > 0) {
    const avg = Math.round(act.reduce((a, s) => a + s.steps, 0) / act.length);
    lines.push(`- Activity: average ${avg} steps/day across ${act.length} days.`);
  }
  if (data.week.workouts.length > 0) {
    lines.push(`- Workouts: ${data.week.workouts.length} sessions logged.`);
  }
  const nut = data.week.nutrition.filter((n) => n.protein_g != null);
  if (nut.length > 0) {
    const avg = Math.round(nut.reduce((a, n) => a + n.protein_g!, 0) / nut.length);
    lines.push(`- Nutrition: protein averaged ${avg}g on ${nut.length} logged days.`);
  }
  lines.push("A full coaching review wasn't available this week.");
  return lines.join("\n");
}

function violationsOf(summary: WeeklySummary, data: WeeklyData): DenylistViolation[] {
  const fromScan = scanSummaryText({
    coachMessage: summary.coach_message,
    recommendationTexts: summary.recommendations.flatMap((r) => [r.message, r.rationale]),
    observationTexts: [
      // EVERY model-generated string that reaches the client gets scanned —
      // evidence included (review finding: it was the one bypass).
      ...summary.domain_analyses.flatMap((d) => [...d.observations, ...d.evidence]),
      ...summary.wins,
      ...summary.focus_areas,
    ],
    hasOutOfRangeFlags: data.biomarkers.flags.some((f) => f.out_of_range),
  });
  const selfCheck = summary.safety_self_check;
  const failedFlags: DenylistViolation[] = [];
  if (!selfCheck.no_diagnosis_language) failedFlags.push({ rule: "self_check_diagnosis", match: selfCheck.notes });
  if (!selfCheck.no_medication_or_dosage_advice) failedFlags.push({ rule: "self_check_medication", match: selfCheck.notes });
  if (!selfCheck.biomarker_phrasing_compliant) failedFlags.push({ rule: "self_check_biomarker", match: selfCheck.notes });
  return [...fromScan, ...failedFlags];
}

async function storeSummary(
  db: Queryable, userId: string, weekStart: string, data: WeeklyData,
  summary: { coach_message: string; wins: string[]; focus_areas: string[]; domain_analyses: unknown[]; recommendations: Array<{ category: string; priority: number; message: string; rationale: string }> },
  meta: { modelVersion: string; promptVersion: string }
): Promise<void> {
  const res = await db.query(
    `insert into weekly_summaries
       (user_id, week_start, metrics_json, findings_json, coach_message, model_version, prompt_version)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (user_id, week_start) do update set
       metrics_json = excluded.metrics_json,
       findings_json = excluded.findings_json,
       coach_message = excluded.coach_message,
       model_version = excluded.model_version,
       prompt_version = excluded.prompt_version,
       created_at = now()
     returning id`,
    [userId, weekStart, JSON.stringify(data), JSON.stringify({
      wins: summary.wins, focus_areas: summary.focus_areas, domain_analyses: summary.domain_analyses,
    }), summary.coach_message, meta.modelVersion, meta.promptVersion]
  );
  const summaryId = res.rows[0].id;
  await db.query(`delete from recommendations where weekly_summary_id = $1`, [summaryId]);
  for (const r of summary.recommendations) {
    await db.query(
      `insert into recommendations (user_id, weekly_summary_id, category, priority, message, rationale)
       values ($1,$2,$3,$4,$5,$6)`,
      [userId, summaryId, r.category, r.priority, r.message, r.rationale]
    );
  }
}

export function makeWeeklyRunnerWithDeps(deps: RunnerDeps): WeeklyRunner {
  const now = deps.now ?? (() => new Date());
  const notify = deps.notify ?? (async () => {});

  return async (weekOverride) => {
    const { db, generate } = deps;
    const { system, version: promptVersion } = composedPrompt();
    const users = await db.query(`select user_id, timezone from profiles`, []);
    const results: WeeklyRunResult[] = [];

    for (const user of users.rows) {
      const userId = user.user_id;
      const weekStart = weekOverride ?? previousWeekStart(now(), user.timezone ?? "America/New_York");
      try {
        // Idempotency: a succeeded run for this (user, week) is never redone.
        const existing = await db.query(
          `select status from coach_runs where user_id = $1 and week_start = $2`,
          [userId, weekStart]);
        if (existing.rows[0]?.status === "succeeded") {
          results.push({ userId, weekStart, status: "skipped", error: "already succeeded" });
          continue;
        }
        await db.query(
          `insert into coach_runs (user_id, week_start, status, prompt_version)
           values ($1,$2,'pending',$3)
           on conflict (user_id, week_start) do update set
             status = 'pending', prompt_version = $3, started_at = now(),
             finished_at = null, error = null`,
          [userId, weekStart, promptVersion]);

        const data = await assembleWeeklyData(db, userId, weekStart);
        const daysWithData =
          data.week.sleep.length + data.week.vitals.length +
          data.week.activity.length + data.week.nutrition.length;
        if (daysWithData === 0) {
          await db.query(
            `update coach_runs set status = 'failed', error = 'no data for week', finished_at = now()
             where user_id = $1 and week_start = $2`, [userId, weekStart]);
          results.push({ userId, weekStart, status: "skipped", error: "no data" });
          continue;
        }

        const userMessage = buildUserMessage(data);
        const inputHash = createHash("sha256")
          .update(promptVersion).update(userMessage).digest("hex").slice(0, 12);

        let totalIn = 0, totalOut = 0, totalCost = 0, modelVersion = "";
        let final: WeeklySummary | undefined;
        let lastViolations: DenylistViolation[] = [];

        for (let attempt = 1; attempt <= 2; attempt++) {
          const message = attempt === 1
            ? userMessage
            : `${userMessage}\n\nYour previous draft violated these safety rules:\n` +
              lastViolations.map((v) => `- ${v.rule}: "${v.match}"`).join("\n") +
              "\nRewrite the review with compliant language. Same data, same structure.";
          const result = await generate(system, message);
          totalIn += result.tokensIn;
          totalOut += result.tokensOut;
          totalCost += result.costUsd;
          modelVersion = result.model;
          lastViolations = violationsOf(result.summary, data);
          if (lastViolations.length === 0) {
            final = result.summary;
            break;
          }
        }

        if (final) {
          await storeSummary(db, userId, weekStart, data, final, { modelVersion, promptVersion });
          await db.query(
            `update coach_runs set status = 'succeeded', model_version = $3, input_hash = $4,
               tokens_in = $5, tokens_out = $6, cost_usd = $7, finished_at = now()
             where user_id = $1 and week_start = $2`,
            [userId, weekStart, modelVersion, inputHash, totalIn, totalOut, totalCost.toFixed(4)]);
          await notify(userId, weekStart);
          results.push({ userId, weekStart, status: "succeeded" });
        } else {
          // Two strikes → deterministic metrics-only fallback (spec §6 skill 8).
          await storeSummary(db, userId, weekStart, data, {
            coach_message: buildFallbackMessage(data),
            wins: [], focus_areas: [], domain_analyses: [], recommendations: [],
          }, { modelVersion, promptVersion });
          await db.query(
            `update coach_runs set status = 'fallback', model_version = $3, input_hash = $4,
               tokens_in = $5, tokens_out = $6, cost_usd = $7, finished_at = now(),
               error = $8, composed_prompt = $9
             where user_id = $1 and week_start = $2`,
            [userId, weekStart, modelVersion, inputHash, totalIn, totalOut, totalCost.toFixed(4),
             `denylist violations after retry: ${lastViolations.map((v) => v.rule).join(", ")}`,
             system]);
          await notify(userId, weekStart);
          results.push({ userId, weekStart, status: "fallback", error: lastViolations.map((v) => v.rule).join(", ") });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown error";
        try {
          await db.query(
            `update coach_runs set status = 'failed', error = $3, finished_at = now()
             where user_id = $1 and week_start = $2`, [userId, weekStart, message]);
        } catch { /* keep the loop alive for other users */ }
        results.push({ userId, weekStart, status: "failed", error: message });
      }
    }
    return results;
  };
}

