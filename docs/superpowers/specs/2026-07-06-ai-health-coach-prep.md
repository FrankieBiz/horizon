# Horizon — AI Health Coach: Setup Plan & Architecture

Status: **Prep phase — no code yet.** This document supersedes and extends the
2026-07-06 Horizon design spec: the product concept has evolved from "habit tracker +
longevity score" to "weekly AI longevity coach." Prior research (HealthKit mechanics,
privacy/compliance, habit modeling, scoring methodology) carries over and is cited where
used. Build happens in a later session (ultracode/Fable).

---

## 1. Product vision

**Plain English:** Horizon is a personal longevity coach on your iPhone. You connect
your wearable (via Apple Health), your food-logging app, and optionally your workouts
and bloodwork. Once a week, Claude reads your last 7 days and writes you a short,
specific coaching message: what went well, what to change next week across sleep,
recovery, nutrition, exercise, and habits. It is practical wellness guidance — never
medical diagnosis.

**Core user value:** You already generate the data (ring, watch, food app, lab work).
Nobody is reading it for you. Horizon turns passive data exhaust into one actionable
weekly conversation — the "what should I actually do differently next week?" that a
human coach would give you, for the cost of a few API calls.

**MVP:**
- Connect Apple HealthKit (sleep, resting HR, HRV, steps/activity, workouts, nutrition)
- Manual fallback entry for nutrition (daily calories + macros) and habits
- Manual bloodwork entry (optional)
- Weekly automated review: deterministic metric analysis + Claude-generated coaching
  message with ≤3 prioritized recommendations
- In-app weekly review screen + push notification when ready
- Account deletion + data export from day one (compliance research: cheapest now)

**Later versions (explicitly deferred):**
- Longevity score / biological-age estimate (from the original spec — deferred, see Open Questions)
- Direct wearable APIs (Oura/Whoop) — HealthKit covers them indirectly
- PDF bloodwork upload with Claude parsing (manual entry first)
- Mid-week nudges, chat-with-your-coach, email delivery
- Web dashboard, Android (would trigger aggregator like Terra)
- In-app food logging with a food database (FatSecret free tier is the path if ever needed)

---

## 2. User workflow

**Daily (mostly passive):**
1. User wears their device; their food app logs meals. Oura/Whoop/Garmin write into
   Apple Health via their own apps; food apps (MacroFactor confirmed, Cronometer/LoseIt/MFP
   likely) write dietary energy/macros into HealthKit.
2. Horizon iOS pulls new HealthKit samples (anchored queries + background delivery),
   collapses them to one-row-per-metric-per-day aggregates, saves locally (SwiftData),
   and syncs to the backend in the background (local-first, reconcile IDs on success).
3. Optional 10-second manual entries: habits done, supplements taken, or macro totals
   if the food app doesn't sync.

**Weekly (the product moment):**
1. Monday morning (user-local), the backend cron job assembles the user's last 7 days
   (+ rolling baselines) from Postgres.
2. Deterministic rules compute metrics and flags ("bedtime variability high," "protein
   below target 4/7 days," "acute training load high while HRV suppressed").
3. Claude turns data + flags into a WeeklySummary: per-domain analysis and ≤3
   prioritized, behavior-focused recommendations, as structured JSON.
4. Safety filter validates the language (no diagnosis, correct biomarker phrasing).
5. Stored in Postgres; push notification fires ("Your weekly review is ready" — no
   health data in the push payload); app renders the coaching message.
6. User reads it in ~2 minutes, picks the top change for the week.

**Occasionally:** After a blood draw, user types results into the biomarker form (with
the lab's own reference ranges). Next weekly review includes trend commentary phrased
as discuss-with-your-doctor guidance, never interpretation.

---

## 3. Integration strategy

Research finding that shapes everything: **Apple HealthKit is the single integration
that covers four of five categories.** Wearables, nutrition apps, and workout apps all
write into it. Fastest-path-first ranking per category:

| Category | Recommended path (MVP) | Why | Fallback / later |
|---|---|---|---|
| Wearable (sleep, HRV, RHR) | **HealthKit** | Oura writes sleep stages/HRV/RHR; Whoop writes RHR/sleep stages (not raw HRV — RMSSD/SDNN mismatch); Garmin writes sleep/steps/workouts since Dec 2024. Everything the weekly analysis needs reaches HealthKit. | Direct Oura API v2 (most indie-friendly, self-serve OAuth) only if users demand readiness scores; Whoop dev-mode caps at 10 users; Garmin requires business approval. Aggregators (Terra ~500 users free; Spike $300/mo minimum) only if Android/server-side pull ever needed. |
| Calorie/nutrition | **HealthKit dietary types** (`dietaryEnergyConsumed`, protein/carbs/fat) | MacroFactor confirmed writes daily macros; Cronometer/LoseIt likely free; MFP writes on all tiers per support docs (verify — history of gating). | **Manual daily-totals entry screen is mandatory** — some apps gate sync (FoodNoms premium-only) or write calories without macros. Detect bad sync via "calories present, macros zero" heuristic. MFP API is closed to indies; Nutritionix no longer has a free tier — dead ends, don't plan on them. |
| Workout/activity | **HealthKit** (`HKWorkoutType`, steps, active energy) | Native for Apple Watch; Garmin/Oura workouts flow through. | Manual workout entry for lifters whose apps don't sync. |
| Bloodwork/labs (optional) | **Manual entry form** — marker, value, unit, and the lab's own reference range | Lab APIs (Junction fka Vital, Health Gorilla, 1up) are enterprise-priced or unconfirmed — not viable solo. Storing the lab's own printed range is a real differentiator: no major competitor does it (InsideTracker/Function/Levels all overlay proprietary "optimal zones"), and it's FHIR-aligned (`Observation.referenceRange`). | Apple Health clinical records (`HKClinicalRecord` `.labResultRecord`) are **self-service** — `health-records` entitlement, no Apple approval — but provider coverage is patchy (Epic/Cerner/athenahealth; last public figure 2022): bonus import later, never the primary path. Phase-2: PDF upload parsed by Claude **with a mandatory review-before-save step** — universal de facto practice (Levels, InsideTracker), and warranted: a 2025 Nature Comms Medicine study found LLMs propagate planted fake lab values in up to 83% of cases without mitigation. |
| Apple Health (as a category) | **It IS the integration layer** | One permission flow, one sync engine. | — |

**Where MCP fits (honest assessment):** MCP is *not* the fastest path for production
data ingestion here — HealthKit is on-device (no server API exists for it), and the
weekly job reads Postgres directly. MCP earns its keep at **development time**: the
Supabase MCP server (or a Postgres MCP server) lets Claude Code inspect the schema, run
queries, and debug sync issues during the build. Recommendation: wire Supabase MCP into
the dev environment in Phase 1; do not build MCP into the production runtime.

**Integration abstraction layer:** one `MetricSource` protocol on iOS
(`healthKit | manual`) producing the same normalized `DailyMetric`/`WorkoutRecord`
values, so the sync engine and analysis never know where data came from. Server-side,
ingestion is **one idempotent upsert endpoint per domain table** (sleep, vitals,
activity, nutrition, body metrics — each keyed `(user_id, local_date)`; workouts keyed
`(user_id, hk_sync_identifier)` with a client-generated UUID for manual workouts).
Conflict rule: `manual` overwrites `healthkit` for the same key (explicit user intent
wins); `healthkit` never overwrites `manual`. Adding a future direct-API source means a
new writer to the same endpoints, nothing else changes.

---

## 4. Architecture

Monorepo at `~/dev/horizon` (already scaffolded as folders):

```
┌─────────────────────────── iPhone (SwiftUI) ────────────────────────────┐
│ HealthKit reader ─┐                                                     │
│ Manual entry ─────┼→ Normalizer → SwiftData (local-first) → Sync engine │
│ Weekly Review UI ←──────────────────────────────────────────┐           │
└─────────────────────────────────────────────────────────────│───────────┘
                              ↓ HTTPS (zod-validated)         │ APNs push
┌────────────────────────── horizon-api (Node/TS) ────────────│───────────┐
│ Ingestion routes → services → Postgres (Supabase)           │           │
│ Weekly job (cron): assemble data → rules engine (code)      │           │
│   → Claude API (skills + structured outputs) → safety filter│           │
│   → weekly_summaries + recommendations → push notification ─┘           │
└──────────────────────────────────────────────────────────────────────────┘
```

**Layers:**
1. **Client app** — SwiftUI + SwiftData, `@Observable` app state, local-first writes.
   HealthKit permission UX designed around the read-denial-is-unknowable constraint
   (always show empty-data state, never "you denied access").
2. **Data ingestion** — iOS-side HealthKit anchored queries (historical import with
   nil anchor; incremental with persisted anchor; `HKStatisticsCollectionQueryDescriptor`
   to collapse to daily aggregates; manual cross-source dedup via `HKSource` priority).
   Server-side: idempotent upsert endpoints.
3. **Normalized health data model** — per-domain daily tables (§5), one row per user
   per local_date, `source` column on everything.
4. **Analysis engine (deterministic, code)** — pure TypeScript module: rolling
   baselines (7d vs 60d), z-scores against personal baseline (per scoring research:
   personal baselines, not population norms), threshold flags. Unit-tested with vitest,
   zero LLM involvement. This is the house "pure engine layer" pattern.
5. **Weekly recommendation engine (Claude)** — one structured API call composing the
   skill prompts (§6), returning validated JSON via `output_config.format`.
6. **Messaging/output layer** — `weekly_summaries` + `recommendations` tables, a GET
   endpoint, an in-app review screen, APNs push with a content-free payload.

**Backend choice — recommendation: Node/TypeScript (Express 5 + raw pg + zod), not Python.**
Rationale: this machine's proven web-backend conventions (elos-api), shared TS types
with any future web dashboard via `horizon-shared`, existing ultron rules/skills for
this stack, and vitest test discipline already established. Python on this machine is
the data-science stack; there's no pandas-shaped work here — the analysis engine is
thresholds and rolling averages, trivial in TS. (Tradeoff: if the scoring engine ever
becomes genuinely statistical/ML, a Python analysis sidecar can be added then — YAGNI now.)

**Rule-based vs LLM-based:**
- Rule-based (code): all metric computation, baselines, flags, streaks, adherence %,
  data-completeness checks, banned-phrase screening, idempotency. Anything that must be
  reproducible and testable.
- LLM-based (Claude): synthesis across domains, prioritization narrative, coaching tone,
  turning flags into human guidance, biomarker trend *phrasing* (not detection —
  detection is rule-based against lab ranges).
- Principle: **Claude never computes numbers; code never writes prose.**

**Avoiding overengineering:**
- No queue/worker infra — one cron job, idempotent by `(user_id, week_start)`.
- No aggregator subscriptions, no direct wearable OAuth flows.
- No microservices — one API service, one job entry point.
- No third-party analytics/error SDKs touching health data (App Store 5.1.3) — plain
  structured logs.
- Multi-user *schema* (user_id + RLS everywhere) but single-user *operations* until
  there's a second user.

---

## 5. Data model

Supabase Postgres, numbered SQL migrations. All tables have `user_id` FK →
`auth.users`, RLS enabled from migration 001. `local_date` is the user-timezone date;
`timezone` captured at write time. `source` ∈ `healthkit | manual` (extensible).
`hk_sync_identifier` nullable, for idempotent HealthKit re-sync/dedup.

```sql
-- Identity (auth = Supabase Auth, Sign in with Apple; profiles.user_id → auth.users)
profiles(user_id PK, display_name, timezone, goals_json, units, created_at)
-- goals_json holds the coaching targets skills read: sleep_need_min,
-- protein_target_g, calorie_target_kcal, weekly_workout_target, primary_goal

-- Daily metrics: one row per user per local_date (aggregated on-device; raw
-- continuous samples are NOT stored — data minimization per privacy research).
-- (user_id, local_date) IS the idempotency key for all *_daily tables;
-- hk_sync_identifier lives only on per-event rows (workouts).
sleep_daily(user_id, local_date, total_min, in_bed_min, deep_min, rem_min,
            core_min, awake_min, bedtime_at, waketime_at, source)
            -- stage columns nullable (not all wearables provide stages)

vitals_daily(user_id, local_date, resting_hr, hrv_sdnn_ms, respiratory_rate,
             source)   -- hrv nullable (Whoop doesn't sync it)

activity_daily(user_id, local_date, steps, active_energy_kcal, exercise_min, source)

workouts(id, user_id, workout_type, start_at, end_at, duration_min,
         active_kcal, avg_hr, distance_m, source, hk_sync_identifier)

nutrition_daily(user_id, local_date, calories_kcal, protein_g, carbs_g, fat_g,
                water_ml, source, is_complete)
                -- is_complete: user-confirmed full day vs partial log;
                -- macros nullable independent of calories (bad-sync heuristic)

body_metrics(user_id, local_date, weight_kg, body_fat_pct, source)
             -- MVP: collected + shown as context in the review; no findings/skill
             -- reads it yet (deliberate — trend analysis is post-MVP)

-- Recovery/readiness: DERIVED, not ingested (computed by the analysis engine)
recovery_daily(user_id, local_date, hrv_dev_from_baseline, rhr_dev_from_baseline,
               readiness_band,   -- enum: good | moderate | suppressed
               model_version)    -- persist vs compute-transiently: open question §11 Q11

-- Habits & supplements (carried over from 2026-07-06 spec §4a: Loop Habit Tracker
-- (N,M) frequency model, weekday bitmask, supplement_details with dose/timing)
habits(...) habit_schedules(...) habit_logs(...) supplement_details(...)

-- Bloodwork (optional feature)
biomarker_panels(id, user_id, drawn_on, lab_name, source, notes)
biomarker_results(id, panel_id, marker, value, unit,
                  ref_low, ref_high,        -- THE LAB'S OWN range, stored per result
                  lab_flag)                 -- ranges vary by lab; never hardcode.
                  -- Differentiator: no major competitor stores the lab's printed
                  -- range (all overlay proprietary bands); FHIR-aligned design.

-- Weekly engine output
weekly_summaries(id, user_id, week_start,
                 metrics_json,    -- the assembled WeeklyData input (auditability)
                 findings_json,   -- Claude's domain_analyses + wins + focus_areas
                 coach_message, model_version, prompt_version, created_at,
                 UNIQUE(user_id, week_start))
recommendations(id, user_id, weekly_summary_id, category,   -- sleep|recovery|nutrition|exercise|habits
                priority, message, rationale, status, created_at)

-- Observability (also the LLM debugging surface)
coach_runs(id, user_id, week_start, status,   -- pending|succeeded|failed|fallback
           prompt_version, input_hash, tokens_in, tokens_out, cost_usd,
           error, started_at, finished_at)
```

**Optional vs required:** bloodwork tables, `body_metrics`, `recovery_daily`, and
workout detail fields are all optional — the weekly review degrades gracefully (a
domain with no data gets "not enough data this week" rather than blocking the run).
Required minimum for a useful review: any one of sleep/vitals/activity present ≥4 of 7 days.

---

## 6. Claude skills (runtime prompt modules)

**Storage strategy:** each skill is a versioned markdown prompt + a zod schema for its
output slice, colocated in `apps/horizon-api/src/coach/skills/` and checked into git.
`prompt_version` (a hash or semver of the composed prompt) is stamped on every
`coach_runs` row so any output can be traced to the exact prompt that produced it.

**Composition decision (recommended):** for MVP, the orchestrator composes all domain
skills into **one** Claude API call (shared context = coherent cross-domain reasoning,
one bill, simpler). The per-skill specs below define the *sections* of that call and
their contracts, so any skill can later be split into its own call without redesign.
Model: `claude-opus-4-8` (quality-sensitive, and cost is trivial: ~8k in / 2k out ≈
**$0.09/user/week**; Batch API halves it at scale). Structured outputs
(`output_config.format` with the WeeklySummary JSON schema) guarantee parseable output.
No temperature parameter (removed on current models); adaptive thinking on.

1. **weekly-health-review** (orchestrator)
   - *Purpose:* produce the complete WeeklySummary from one week of data.
   - *Inputs:* `WeeklyData` JSON — per-domain 7-day series, 60-day baselines,
     deterministic findings[] from the rules engine, user profile/goals, last week's
     summary + recommendations (for continuity and non-repetition).
   - *Output:* `WeeklySummary` JSON: `{domain_analyses{}, wins[], focus_areas[],
     coach_message, recommendations[≤3]}`. The `recommendations` and `coach_message`
     fields are produced by the recommendation-generation section (skill 7) — it is
     the single authority for them; no other section emits recommendations.
   - *Logic:* synthesize, don't recompute; every claim must cite a supplied metric;
     acknowledge last week's recommendation follow-through.
   - *Edge cases:* sparse week (travel, dead battery) → shorter honest review, never
     fabricate; first-ever week → welcome framing, no trend claims.
   - *Runs:* weekly cron job, after rules engine, before safety filter.

2. **sleep-recovery-analysis**
   - *Purpose:* interpret sleep + vitals against personal baseline.
   - *Inputs:* sleep_daily 7d, vitals_daily 7d, 60d baselines (mean/SD), findings flags.
   - *Output:* `{domain: "sleep_recovery", observations[], severity, evidence[]}`.
   - *Logic/rules (deterministic flags computed in code, interpreted here):* bedtime
     SD > 60min → consistency flag; duration < `sleep_need_min` (from
     `profiles.goals_json`, default 450) on ≥3 nights; HRV 7d avg > 1 SD
     below 60d baseline AND RHR elevated → recovery-suppressed flag (personal baseline
     z-scores per Oura/Whoop research — never population norms).
   - *Edge cases:* < 60d history → "building your baseline" language, no deviation
     claims; missing stage data (Garmin/older devices) → duration-only analysis;
     timezone shifts → suppress consistency flag for travel weeks.

3. **nutrition-analysis**
   - *Purpose:* adherence and pattern reading, not diet prescription.
   - *Inputs:* nutrition_daily 7d, protein/calorie targets from profile, logging-completeness.
   - *Output:* same shape, `domain: "nutrition"`.
   - *Logic:* protein < 0.8×target on ≥4 logged days → protein flag; distinguish
     "didn't log" from "didn't eat" (missing ≠ zero — hard rule); calorie variance
     commentary only when ≥5 complete days.
   - *Edge cases:* calories-without-macros days (bad HealthKit sync) → count as partial;
     zero logged days → coaching about logging habit, not nutrition.

4. **training-load-analysis**
   - *Purpose:* balance load vs recovery.
   - *Inputs:* workouts 4 weeks, activity_daily 4 weeks, recovery flags from skill 2.
   - *Output:* same shape, `domain: "exercise"`.
   - *Logic:* acute (7d) vs chronic (28d) load ratio > ~1.3 with recovery suppressed →
     pull-back recommendation; steps < 70% of 4-week median → low-activity flag;
     zero workouts + normal steps → distinguish rest week from detraining trend (≥2 weeks).
   - *Edge cases:* duplicate workouts from multiple sources (dedup should have caught;
     sanity-check durations); manual-only users with no HR data → volume-based analysis.

5. **habits-analysis**
   - *Purpose:* adherence reading on the user's own declared habits and supplement
     routine — the fifth coaching domain.
   - *Inputs:* habits + habit_schedules + habit_logs 7d (and 30d adherence %),
     supplement_details, findings flags.
   - *Output:* same shape, `domain: "habits"`.
   - *Logic:* adherence % per habit vs its schedule (Loop-style due/done computation
     from the prior spec); adherence dropped > 25 points vs 30d average → slipping
     flag; strong streak → win candidate; supplements: logged-vs-scheduled only,
     never efficacy claims or dosage advice.
   - *Edge cases:* no habits configured → domain silently omitted (not an error);
     as-needed habits excluded from adherence math (per prior spec open question —
     default: exclude).

6. **biomarker-review** (only when a new panel exists since last review, or quarterly reminder)
   - *Purpose:* flag out-of-range values and trends for doctor follow-up. **Never interpret.**
   - *Inputs:* latest panel with lab ranges, prior panels for the same markers.
   - *Output:* `{domain: "biomarkers", flagged[], trend_notes[], see_doctor: bool}`.
   - *Logic:* out-of-lab-range → neutral flag with mandated phrasing (§9); same marker
     moving consistently across ≥2 panels → trend note; in-range everything → positive
     confirmation, no invented concerns.
   - *Edge cases:* single panel → no trend language; unit mismatch across panels →
     flag data issue, don't convert silently; missing reference range → report value
     only, no range judgment.

7. **recommendation-generation**
   - *Purpose:* turn all domain observations into ≤3 prioritized behavior changes + the
     final coach message.
   - *Inputs:* all domain outputs, user goals, last week's recommendations + status.
   - *Output:* `recommendations[≤3]` (category, priority, message, rationale) +
     `coach_message` (≤200 words, warm, specific, references actual numbers).
   - *Logic:* one behavior change per domain max; recovery conflicts win (if recovery
     says rest and activity says move more → rest, explain why); don't repeat an
     identical recommendation more than 2 consecutive weeks — escalate specificity or
     switch focus; behavior-focused ("in bed by 11 on weeknights") never outcome-focused
     ("improve your HRV").
   - *Edge cases:* great week → consolidation message, not manufactured problems;
     everything bad → pick ONE thing (overwhelm kills adherence).

8. **safety-compliance-filter**
   - *Purpose:* final gate before anything is stored/delivered.
   - *Inputs:* draft coach_message + recommendations.
   - *Output:* `{pass: bool, violations[], rewritten_text?}`.
   - *Logic (two layers):* (a) code-level deny-list scan — diagnose/cure/treat/prescribe/
     "you have [condition]"/dosage-change language — cheap, deterministic, runs first;
     (b) LLM pass checking framing rules (biomarker phrasing, escalation language,
     disclaimer presence for biomarker content). To be precise about the architecture:
     there is **one Claude call total** — the LLM safety pass is a self-check section
     inside that call's structured output; the code-level deny-list scan then runs on
     the returned text as the independent hard backstop. (§4's "→ safety filter" stage
     refers to this code-level scan, not a second Claude call.)
   - *Edge cases:* fails twice → deliver conservative fallback template ("Your weekly
     data summary is ready" + raw metrics, no generated prose) and mark
     `coach_runs.status = fallback` for review.
   - *Runs:* last, always; nothing user-facing skips it.

---

## 7. Recommendation engine logic

Two-stage: **deterministic findings → LLM synthesis** (Claude never computes, code never writes prose).

Stage 1 (code) emits typed findings like:

| Finding (example thresholds — tune in Phase 4) | Signal | Behavior-focused output shape |
|---|---|---|
| `sleep_consistency_low` | bedtime SD > 60 min across 7d | "Anchor your bedtime: 11pm five nights this week" |
| `recovery_suppressed_load_high` | HRV 7d > 1 SD below 60d baseline + acute:chronic load > 1.3 | "Swap one hard session for a walk; recheck next week" |
| `protein_adherence_low` | < 0.8× target on ≥4 logged days | "Add a protein anchor to breakfast — you hit target on days you did X" |
| `activity_low_week` | steps < 70% of 4-week median | "Two 15-min walks on your low days (Tue/Thu were lowest)" |
| `habit_adherence_slipping` | habit adherence % dropped > 25 points vs 30d average | "Vitamin D slipped to 3/7 this week from a 90% month — pair it with your morning coffee" |
| `biomarker_out_of_range_trend` | marker outside lab range, consistent direction ≥2 panels | "Your [marker] has been above your lab's reference range in your last two panels — worth bringing up with your doctor at your next visit. Not something this app can interpret." |
| `logging_gap` | < 4 days data in a domain | "The coach is only as good as the data — reconnect X / quick-log Y" |

Stage 2 (Claude) prioritizes (safety-relevant recovery findings first, then user goals,
then biggest-gap), selects ≤3, writes the message. Non-medical framing is enforced by
prompt + filter: recommendations are always about *behavior the user controls*, never
about treating/fixing a marker or condition.

---

## 8. Setup blueprint

**Folder structure** (extends the existing skeleton):

```
horizon/
├── apps/
│   ├── horizon-ios/                 # SwiftUI app (Xcode project, Phase 5)
│   │   └── (HealthKit/, Sync/, ManualEntry/, WeeklyReview/, Engine/ pure-Swift)
│   └── horizon-api/
│       └── src/
│           ├── routes/              # thin handlers; zod at the boundary
│           ├── services/            # ALL business logic (house rule)
│           ├── analysis/            # pure rules engine: baselines, flags (vitest)
│           ├── coach/
│           │   ├── skills/          # *.md prompt modules (§6), versioned
│           │   ├── schemas/         # zod schemas for WeeklyData / WeeklySummary
│           │   └── run.ts           # orchestrator: assemble → rules → Claude → filter → store
│           ├── jobs/weekly.ts       # cron entry point (also callable via authed route)
│           └── db/                  # pg pool, query helpers
├── packages/horizon-shared/         # request/response contracts (TS)
├── supabase/migrations/             # 001_..., 002_... numbered SQL
├── infra/                           # render.yaml (web service + cron job)
└── docs/superpowers/specs/          # this file + prior spec
```

**Service boundaries:** one deployable API service; the weekly job is a second entry
point on the same codebase (Render cron job running `node dist/jobs/weekly.js`), not a
separate service. iOS talks only to `horizon-api`; `horizon-api` is the only thing
talking to Claude and Postgres.

**Environment variables:**

```
DATABASE_URL                # Supabase Postgres (pooled)
SUPABASE_URL
SUPABASE_ANON_KEY           # iOS auth flows
SUPABASE_SERVICE_ROLE_KEY   # server-side only, never shipped to client
ANTHROPIC_API_KEY
ANTHROPIC_MODEL             # default claude-opus-4-8 (override for testing)
CRON_SECRET                 # protects the manual-trigger route POST /internal/coach/run
PORT / NODE_ENV / LOG_LEVEL
APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY_P8 / APNS_BUNDLE_ID   # push (Phase 6)
```

**Database schema outline:** §5, applied as numbered migrations; RLS policies in the
same migration that creates each table.

**Integration abstraction:** §3 — `MetricSource` protocol on iOS; single idempotent
upsert contract server-side keyed `(user_id, local_date, metric)`.

**Prompt/skill storage:** §6 — markdown + zod in-repo, `prompt_version` stamped per run.

**Cron/scheduler strategy:** Render Cron Job, weekly (`0 12 * * 1` UTC ≈ Monday morning
US-East; per-user timezone fan-out is a later refinement — for a single user, fixed time
is fine). Job is idempotent via `UNIQUE(user_id, week_start)` — reruns are safe.
`POST /internal/coach/run?week=...` guarded by `CRON_SECRET` for manual/debug triggers.
Claude call: plain Messages API for now; switch to **Batch API at ~50+ users** (50%
discount, results typically < 1 hour — perfect for a non-latency-sensitive weekly job).

**Logging & debugging strategy:**
- Structured JSON logs (pino) — request logs exclude health-data payloads by default.
- `coach_runs` is the LLM observability table: prompt_version, input_hash, token counts,
  cost, status, error. Every weird output is reproducible: same input + same
  prompt_version → re-run and diff.
- Store the composed prompt for failed/fallback runs only (bounded retention) to debug
  without hoarding health data.
- No Sentry/analytics SDKs in any path that touches health data (App Store 5.1.3).

**Privacy/security checklist (from compliance research, do-now items):**
- [ ] TLS everywhere (Supabase/Render default); RLS on every table from migration 001
- [ ] Store daily aggregates, not raw continuous samples (minimization)
- [ ] No HealthKit-derived data to any third-party SDK, ads, or analytics — ever (5.1.3)
- [ ] No personal health data in iCloud (5.1.3(ii)) or in push payloads
- [ ] Account-deletion endpoint cascading all tables + data-export endpoint (JSON) — Phase 2, not retrofit
- [ ] Standalone health-data privacy policy, listing exact HealthKit types read (Washington MHMDA requires it separate from the general policy; private right of action up to $25k/violation — highest-risk item for a solo dev)
- [ ] Opt-in consent screen at onboarding (MHMDA), plus Info.plist purpose strings
- [ ] Lightweight breach-response runbook (FTC Health Breach Notification Rule applies to solo devs)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` server-only; API keys in env, never in repo
- [ ] Consider pgcrypto column encryption for biomarker values as defense-in-depth (defer if single-user)

---

## 9. Safety boundaries

**What Horizon is:** wellness and performance guidance based on the user's own behavior
and data. FDA "general wellness" category — stays there by never making disease-specific
claims (diagnose, treat, cure, mitigate, prevent).

**The app must never:**
- Diagnose any condition, or say data "indicates," "suggests you have," or "is a sign of" any disease
- Recommend starting/stopping/dosing medication or supplements (logging a supplement the user already takes is fine; prescribing changes is not)
- Interpret bloodwork beyond "outside the reference range your lab provided" + trend direction
- Claim to detect, predict, or reduce risk of any disease
- Present the coaching as a substitute for medical care

**Mandated biomarker phrasing (enforced by the safety filter):**
> "Your [marker] was outside the reference range your lab provided ([value] vs [range]).
> That's worth discussing with your doctor — this app can't interpret lab results."
Never: "your cholesterol is dangerous," "this indicates prediabetes," etc. Use
"in range / outside range" language, never "normal/abnormal" (the confirmed category
pattern — Levels: "not intended to diagnose, treat, cure, or prevent any disease…
general-wellness purposes only"; Function Health ToS uses equivalent framing).

**Escalation paths:**
- Red-flag data patterns (e.g., sustained extreme RHR deviation) → generic "consider
  checking in with a healthcare provider" language — stated as data anomaly, not diagnosis
- Any user-entered free text mentioning chest pain, fainting, self-harm → fixed response
  directing to appropriate care/crisis resources, never coached around
- Safety filter double-failure → metrics-only fallback template, flagged for review

**Disclaimers:** onboarding acceptance ("Horizon provides general wellness information,
not medical advice…") + persistent footer on every weekly review + biomarker screens.

**Risky areas to watch:** biomarker commentary (tightest filter), anything resembling
calorie prescription for users with disordered-eating signals (keep nutrition coaching
adherence-based, not restriction-based), sleep/recovery language that could discourage
someone from seeking care ("your HRV is fine" is not a health clearance).

---

## 10. Build phases (no code until Phase 1 begins)

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Decisions & architecture** | Resolve §11 open questions; freeze MVP scope; pin thresholds table v1; write privacy policy draft | This doc's open questions answered; spec re-reviewed |
| **1. Data connectors** | iOS project scaffold; HealthKit permission flow + anchored-query sync for sleep/vitals/activity/workouts/nutrition; manual entry screens (nutrition totals, habits, biomarkers); local SwiftData store | Real device shows 7 days of correct daily aggregates from the user's actual wearable + food app; manual entries persist |
| **2. Schema & storage** | Supabase project; migrations 001-00N (§5) with RLS; horizon-api scaffold (Express 5 + zod + pg); per-domain ingestion upsert endpoints; iOS sync engine (local-first, reconcile); deletion + export endpoints. Dev-time: Supabase MCP wired into Claude Code once the schema exists | Data flows device → Postgres idempotently; re-sync produces no duplicates; delete/export work; vitest green |
| **3. Claude skill definitions** | Write all 8 skill prompts + zod schemas (biomarker-review written but dormant until real panels exist — activation is a Phase 4 decision); WeeklyData assembler; golden-file tests (fixed WeeklyData fixtures → assert structure, phrasing rules, banned-phrase absence) | Skills produce valid WeeklySummary JSON on 5+ fixture weeks incl. sparse/edge weeks; deny-list scan has unit tests |
| **4. Weekly analysis workflow** | Rules engine (baselines, flags) as pure TS module + tests; orchestrator run.ts; coach_runs logging; cron job + manual trigger; tune thresholds against the user's own real backfilled data | End-to-end run against real data produces a sane review; rerun is idempotent; cost/tokens logged; ~$0.10/run confirmed |
| **5. Mobile UI** | Weekly Review screen; dashboard (this week vs baseline); biomarker entry/history; onboarding (account creation via Supabase Auth + Sign in with Apple, consent, HealthKit permissions, goals); empty/sparse states | Full flow usable on device by a non-developer; empty states everywhere; onboarding < 3 min |
| **6. Messaging & polish** | APNs push (content-free payload); review-ready deep link; recommendation status (read/acted); copy polish; app icon/branding | Push arrives Monday; tap → review; weekly loop feels like a product |
| **7. Safety review & testing** | Adversarial testing of the filter (seeded bad outputs); red-flag path tests; privacy checklist audit (§8); /ship gate (typecheck + full suites); security-reviewer + adversarial-verifier agents over the diff; TestFlight build | Filter catches seeded violations; checklist fully checked; suites green; running on the user's phone for a real week |

Each phase ends with the tree in a verified, committed state (async work discipline).

---

## 11. Open questions / decisions needed before coding

1. **Single-user or multi-user?** Is this for you personally (TestFlight, one user) or
   built to ship to others? *Recommendation:* multi-user schema (user_id + RLS is nearly
   free now, painful later), single-user operations; defer App Store/compliance polish
   until a second user exists.
2. **Does the longevity score survive?** The original spec centered a computed score;
   this concept centers the weekly message. *Recommendation:* drop the score from MVP;
   the weekly review's "wins/focus areas" covers the need. Revisit as a
   contributors-style breakdown later (research: opaque single scores are the
   most-criticized pattern anyway).
3. **Which food app do you actually use?** Determines whether HealthKit nutrition
   write-through works day one (MacroFactor: confirmed; MFP free tier: verify) or
   whether manual entry is your primary path.
4. **Bloodwork in MVP at all?** It's marked optional. *Recommendation:* include the
   manual-entry tables + form (cheap), ship biomarker-review skill in Phase 4 only if
   you have real panels to test with.
5. **Week boundary:** Monday morning user-local? (Affects cron + "week_start" semantics.)
   *Recommendation:* Monday, computed in user timezone, cron fires ~7am ET.
6. **Subjective daily check-in** (energy/mood/soreness, 10 seconds/day) — adds real
   coaching signal but also daily friction. *Recommendation:* defer to post-MVP; the
   habit logger can absorb it later.
7. **Delivery channel:** push + in-app only for MVP? *Recommendation:* yes; email later.
8. **Habits scope:** keep the full habit/supplement tracker from the original spec, or
   slim to a fixed checklist for MVP? *Recommendation:* keep the schema (already
   designed), build only the minimal logging UI needed to feed the "habits" coaching
   dimension.
9. **Claude spend ceiling:** ~$0.40/user/month at weekly cadence — confirm that's fine
   (it enables Opus-tier quality; there is no reason to economize here).
10. **PhenoAge-style biological age** ever, or stay behavior-focused? (Affects whether
    biomarker schema needs the specific PhenoAge marker set.) *Recommendation:* stay
    behavior-focused; revisit only with recurring lab data.
11. **Persist `recovery_daily` or compute transiently?** The weekly job can derive
    HRV/RHR deviations on the fly from `vitals_daily`; a persisted table only pays off
    if a daily readiness UI ships. *Recommendation:* compute transiently in MVP, add
    the table when/if a daily readiness view is built.
