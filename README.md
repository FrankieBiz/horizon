# Horizon

A personal longevity coach. Your wearable, food app, and optional bloodwork flow
into Apple Health; once a week, Claude reads the last 7 days against your own
baselines and writes you a short, specific coaching review — sleep, recovery,
nutrition, exercise, habits. Wellness guidance, never medical advice.

## Repo map

```
apps/horizon-ios/        SwiftUI app (XcodeGen project.yml; HorizonKit = pure engine pkg)
apps/horizon-api/        Express 5 + raw pg + zod; weekly coach orchestrator in src/coach/
packages/horizon-shared/ zod wire contracts shared across clients
supabase/migrations/     numbered SQL, RLS on every table
infra/render.yaml        web service + Monday cron blueprint
docs/superpowers/specs/  the design specs this was built from
docs/privacy/            standalone health-data privacy policy (MHMDA)
SETUP.md                 the runbook: accounts, keys, device steps
```

## How the weekly review works

Device → HealthKit anchored queries → daily aggregates (HorizonKit normalizer,
cross-source dedup) → local SwiftData → idempotent sync to Postgres. Monday
cron: assemble WeeklyData (7d week + 56d personal baselines) → deterministic
rules engine emits findings (pinned thresholds v1) → one structured Claude call
(8 composed skill prompts) → deny-list safety scan (retry once, then
metrics-only fallback) → stored summary + ≤3 recommendations → content-free
push → app renders the review. Every run is reproducible via `coach_runs`
(prompt version, input hash, tokens, cost).

## Development

```sh
pnpm install && pnpm -r typecheck && pnpm --filter horizon-api test   # backend
cd apps/horizon-ios/Packages/HorizonKit && swift test                 # engine
cd apps/horizon-ios && xcodegen && open Horizon.xcodeproj             # app
```

Start with `SETUP.md` for everything account/device-side.
