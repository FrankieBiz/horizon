# Horizon — Design Spec

Status: **Prep phase.** Design approved 2026-07-06; folder skeleton and research complete;
implementation not yet started. Full build will happen in a later session with a detailed
prompt (ultracode/Fable).

## 1. Overview

Horizon is a native iOS longevity/health-tracking app. MVP scope:
- Manual daily habit tracking: sleep, exercise, diet, supplements
- Automatic sync from Apple HealthKit: sleep, workouts, steps, resting heart rate, HRV
- A computed "longevity score" / dashboard aggregating habit + HealthKit data, with trends
  and actionable insights — minimally defined as surfacing which contributor moved the
  score most (e.g. "sleep duration was the biggest driver of today's dip"), matching the
  Oura/Whoop "contributors" pattern from research (§5). Anything beyond that (recommendations,
  coaching copy) is post-MVP.

Explicitly out of scope for MVP: bloodwork/biomarker tracking, direct third-party wearable
APIs (Oura/Whoop) — HealthKit already surfaces their data indirectly.

**Open question**: "diet" tracking scope is unresolved. Current assumption is a simple
habit-level entry (e.g. yes/no or a short note), *not* calorie/macro logging — that would
need its own detail table analogous to `supplement_details` and is a meaningfully bigger
feature. Confirm scope before implementation.

## 2. Architecture

Monorepo at `~/dev/horizon`, mirroring the pattern already proven in `~/dev/elos`:

```
horizon/
├── apps/
│   ├── horizon-ios/      # SwiftUI native app
│   └── horizon-api/      # Node/Express + TypeScript API
├── packages/
│   └── horizon-shared/   # shared TS types/contracts (API <-> app)
├── supabase/             # Postgres schema, numbered migrations, auth
├── infra/                # deploy config (Render, etc.)
└── docs/                 # specs (this file lives here)
```

Backend + sync from day one (not local-only), per approved design: Express 5 + TypeScript +
raw `pg` (no ORM) + zod, Supabase Postgres + Supabase Auth — same conventions as `elos-api`.

## 3. Data flow

- **Local-first**: iOS app writes to SwiftData with a local UUID immediately, syncs to
  `horizon-api` in the background, reconciles server IDs on success (same pattern as ELOS).
- **HealthKit data** is pulled via HealthKit queries, transformed into the same internal
  habit/metric records, and merged into the local store alongside manually-logged habits.
- **Longevity score** is computed **client-side for MVP**, as a pure, dependency-free Swift
  layer (no UI/IO coupling) — unit-testable in isolation, consistent with the house
  "engine layer" pattern. Result is cached locally (e.g. a local `daily_scores` table) and
  recomputed on new data; no server-side batch job in MVP. A server-side nightly job is a
  **post-MVP** option if cross-device consistency turns out to matter — do not build both.

## 4. Data model — habits, supplements & health metrics

### 4a. Habits & supplements

Informed by research into Loop Habit Tracker (open source), RFC 5545, and HL7 FHIR
`MedicationRequest.dosageInstruction`:

```sql
habits(id, user_id, name, type, target_value, target_type, unit)

habit_schedules(
  habit_id,
  frequency_type,   -- daily | n_times_per_week | specific_weekdays | as_needed | interval_days
  freq_numerator,   -- e.g. 2 of "2x/week" — Loop Habit Tracker's (N, M) model, simpler than RRULE
  freq_denominator, -- e.g. 7 of "2x/week"
  weekday_mask,     -- bitmask for specific-weekday habits
  interval_days
)

habit_logs(habit_id, local_date, value, completed_at, timezone)

supplement_details(
  habit_id, product_name, brand, dose_amount, dose_unit,
  timing_of_day,    -- morning | midday | evening | with_food | empty_stomach
  route
)
```

`habit_logs` gets nullable `dose_amount_actual`/`dose_unit_actual` for supplements,
defaulting to the spec in `supplement_details` but overridable per log.

**Streaks**: use Loop Habit Tracker's exponential-decay score
(`score = prevScore*multiplier + checkmarkValue*(1-multiplier)`,
`multiplier = 0.5^(sqrt(frequency)/13)`) rather than a naive day-counter — it avoids the
"week isn't over yet" ambiguity for N-times-per-week habits. Pick this **or** a hard
counter, not both.

**Rolling windows** (7/30-day habit adherence %, distinct from the longevity score in §5):
compute on the fly from an indexed `habit_logs(habit_id, local_date)` — no rollup table
needed at this scale.

**Open questions deferred to implementation**: proactive streak-freeze vs. retroactive
grace for missed days; timezone-crossing mid-streak reconciliation; whether as-needed
items count toward adherence at all; grace-period length for late-night logs.

### 4b. HealthKit-sourced metrics

The longevity engine (§5) and HealthKit plan (§6) both depend on stored per-metric history,
which needs its own tables separate from habits:

```sql
health_metric_samples(
  id, user_id, metric_type,   -- resting_heart_rate | hrv_sdnn | step_count | sleep_duration_minutes
  value, unit, local_date,
  source,                     -- which app/device wrote it, from HKSource
  healthkit_sync_identifier   -- HKMetadataKeySyncIdentifier, for idempotent re-sync/dedup
)

workout_logs(
  id, user_id, workout_type, start_at, end_at, duration_minutes, calories,
  source, healthkit_sync_identifier
)
```

Per the data-minimization principle in §7, `health_metric_samples` stores **one row per
metric per day** (e.g. nightly resting HR, nightly HRV average, daily step total, nightly
sleep duration) — not raw continuous HealthKit samples. `workout_logs` stores one row per
discrete workout session. This daily-granularity choice is what feeds both the §5 z-score
baseline and the §4a-style rolling windows.

## 5. Longevity scoring engine

Research into PhenoAge, Oura Readiness, Whoop Recovery, and Apple's Cardio Fitness/VO2max
surfaced a consistent methodology, since no vendor publishes exact formulas:

- **Per-metric z-scoring against a rolling personal baseline** (~2 months mean/SD), not
  population norms — personal-baseline normalization is treated as a near-requirement
  (a given HRV value means very different things for different people).
- **Weighted average of the z-scores**, with recency weighting (last 2–5 days weighted
  more than older data).
- Near-universal inputs across vendors: HRV, resting heart rate, activity, sleep duration.
- Known pitfalls to design around: no manufacturer discloses exact weights (so Horizon's
  score won't be directly comparable to Oura/Whoop numbers — don't imply it is); composite
  scores risk oversimplification and are gameable if built on effort-proxies rather than
  outcomes; avoid false precision (e.g. don't present a single opaque number with no
  breakdown — Apple's approach of a validated single metric + trend, or Oura/Whoop's
  "contributors" breakdown, are both more defensible than a black-box score).

The actual weighting/formula is an implementation-time decision, not finalized here.

**Open question**: cold-start baseline. Personal z-scoring needs ~2 months of history a
brand-new user won't have. Needs a decision at implementation time (e.g. population-norm
fallback that phases out as personal data accumulates, or simply hide the score until a
minimum history threshold is met).

## 6. HealthKit integration plan

- Use the async API (`requestAuthorization(toShare:read:)`) and, since Horizon is
  SwiftUI-first, the iOS 17+ `.healthDataAccessRequest` view modifier from `HealthKitUI`.
- Required Info.plist keys: `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`.
- **Design constraint**: HealthKit deliberately makes read-denial unknowable
  (`authorizationStatus(for:)` can't distinguish "denied" from "no data") — never build a
  "you denied access" message; always design for an empty-data state instead.
- Data types read: sleep analysis, workouts, step count, resting heart rate
  (`HKQuantityTypeIdentifier.restingHeartRate`), and HRV
  (`HKQuantityTypeIdentifier.heartRateVariabilitySDNN`) — these map directly to the
  `health_metric_samples`/`workout_logs` tables in §4b.
- Historical import: `HKAnchoredObjectQuery` with `anchor: nil`. Incremental sync: same
  query type with a persisted anchor + `updateHandler`. Aggregates (daily steps, HR
  trends): `HKStatisticsCollectionQueryDescriptor` — used to collapse raw samples down to
  the one-row-per-metric-per-day granularity stored in §4b.
- Background delivery requires the separate
  `com.apple.developer.healthkit.background-delivery` entitlement, `HKObserverQuery` +
  `enableBackgroundDelivery`, and **must** be tested on a real device — the simulator does
  not support background HealthKit queries at all.
- **Must dedup manually**: HealthKit does not dedupe samples across sources (e.g. a
  workout logged by both Watch and a third-party app). Use `HKSource`/`HKSourceQuery` plus
  a source-priority heuristic; use `HKMetadataKeySyncIdentifier`/`SyncVersion` for
  idempotent re-writes of Horizon's own samples.
- Expect multi-hour-to-next-day sync lag from non-Watch sources (Oura syncs sleep the
  next morning; Whoop's proprietary scores never reach HealthKit at all, only raw
  physiological data).

## 7. Privacy & compliance plan

Horizon is not a HIPAA-covered entity, but several other obligations apply directly:

- **App Store Guideline 5.1.3**: HealthKit-derived data may never be used for advertising,
  marketing, or third-party data-mining — exclude HealthKit fields from any general
  analytics/ad SDK entirely, route them only to Horizon's own backend. No storing personal
  health data in iCloud. Privacy policy must enumerate exact HealthKit data types collected.
- **Server-side**: TLS in transit (default), encryption at rest (Supabase Postgres default;
  consider `pgcrypto` column-level encryption for HRV/notes as defense-in-depth). Minimize
  retained fields — store aggregates where raw HealthKit granularity isn't needed.
- **Build now, cheap later**: account deletion cascading to all synced records, and a full
  data export endpoint. Satisfies most of CCPA/GDPR/MHMDA's consumer-rights requirements
  and is far more expensive to retrofit than to build day one.
- **Washington My Health My Data Act** is the single highest-risk item for a solo
  developer: applies regardless of company size, requires a standalone health-data privacy
  policy (not bundled with the general one) and opt-in consent, and carries a private right
  of action with damages up to $25,000/violation.
- **FTC Health Breach Notification Rule** (effective 2024-07-29) applies to apps that draw
  health data from multiple sources — keep a lightweight breach-response runbook from day one.

## 8. Testing strategy

- Swift Testing for the longevity-score engine (pure Swift, no UI/IO) and other iOS logic;
  run with `-parallel-testing-enabled NO` on a real device where HealthKit is involved.
- vitest for `horizon-api`.
- Unit-test the streak/adherence calculation independently of the UI, per the same
  "pure engine layer" pattern as the scoring engine.

## 9. Status / next steps

This spec covers prep-phase research and architecture only. No code has been scaffolded
(no Xcode project, no npm workspace) — that begins once the user provides the full build
prompt for the ultracode/Fable-driven implementation pass. `git init` for this repo is
pending (blocked by sandbox restrictions in this session; to be run manually by the user).
