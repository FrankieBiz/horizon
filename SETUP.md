# Horizon — Setup Runbook

Everything the build could not do autonomously (accounts, keys, physical device).
Work top to bottom; each step says what it unblocks. Rough total: ~1–2 hours of
clicking, then a week of passive data collection.

## 0. Verify the code on this machine (5 min)

The build sandbox couldn't run SwiftPM or bind sockets; these run fine in a
normal terminal:

```sh
# Pure engine tests (should be all green)
cd ~/dev/horizon/apps/horizon-ios/Packages/HorizonKit && swift test

# Backend suite (should be 99 passing, as committed)
cd ~/dev/horizon && pnpm install && pnpm -r typecheck && pnpm --filter horizon-api test
```

## 1. Generate the Xcode project (5 min)

```sh
brew install xcodegen
cd ~/dev/horizon/apps/horizon-ios && xcodegen && open Horizon.xcodeproj
```

In Xcode: Signing & Capabilities → select your team (or set `DEVELOPMENT_TEAM`
in `project.yml` and re-run `xcodegen`). The HealthKit, background-delivery,
Sign in with Apple, and push entitlements are already in the generated project.
Build for the simulator now to compile-verify the app target (the one check the
build environment couldn't run).

## 2. Supabase project (20 min) — unblocks auth + database

1. Create a project at supabase.com. Note from Settings → API:
   `SUPABASE_URL`, `anon` key, `service_role` key, and (Settings → API → JWT)
   the `JWT secret`; from Settings → Database the pooled `DATABASE_URL`.
2. Apply migrations:
   ```sh
   psql "$DATABASE_URL" -f supabase/migrations/001_core.sql \
     -f supabase/migrations/002_habits.sql \
     -f supabase/migrations/003_biomarkers.sql \
     -f supabase/migrations/004_weekly.sql
   ```
3. Auth → Providers → Apple: enable, using your Apple Developer Services ID
   (Supabase docs walk through the Sign in with Apple config; for an
   iOS-native-only app the client ID is your app's bundle id
   `com.frankbisignano.Horizon`).
4. Paste into `apps/horizon-ios/Horizon/Sync/AuthService.swift`:
   `supabaseURL` and `supabaseAnonKey` (the anon key is safe to ship).

## 3. LLM key for the coach (2 min) — unblocks the weekly review

The app is configured for **DeepSeek** (`LLM_PROVIDER=deepseek`). You already have a
DeepSeek key on this machine (macOS Keychain, service `deepseek-api`, used by
`dsclaude`) — reuse it, or get/top-up one at platform.deepseek.com. That value is
`DEEPSEEK_API_KEY`. Retrieve the existing key with:

```sh
security find-generic-password -s deepseek-api -w
```

Cost is a few cents/month for one user on `deepseek-chat`. **Privacy note:** on this
provider a week of your health data is sent to DeepSeek (operated from China) to write
the review — see `docs/privacy/health-data-privacy-policy.md`. To use Claude instead,
set `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (from console.anthropic.com) in
Render — no code change.

## 4. Deploy the API on Render (20 min)

`infra/render.yaml` is a Blueprint — Render → New → Blueprint → point at the
repo (push it to GitHub first: create a private repo, `git remote add origin
… && git push -u origin main`; note `gh` CLI is not installed — use the web UI).
Fill the env vars it prompts for (table below). This creates:
- **horizon-api** web service (health check `/health`)
- **horizon-weekly** cron job — Mondays 12:00 UTC (≈7–8am ET), runs `pnpm job:weekly`

| Env var | Value |
|---|---|
| `DATABASE_URL` | Supabase pooled connection string |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` | from step 2 |
| `LLM_PROVIDER` | `deepseek` (blueprint default) |
| `DEEPSEEK_API_KEY` | from step 3 |
| `DEEPSEEK_MODEL` | `deepseek-chat` (blueprint default) |
| `ANTHROPIC_API_KEY` | leave blank unless you set `LLM_PROVIDER=anthropic` |
| `CRON_SECRET` | any random ≥16 chars — also used for manual triggers |
| `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_KEY_P8` / `APNS_ENV` | from step 5 (leave unset until then — push simply stays off) |
| `NODE_ENV` | `production` |

Then set the production URL in `apps/horizon-ios/Horizon/Sync/APIClient.swift`
(the `#else` branch) if your Render service name differs.

## 5. APNs key (10 min) — unblocks the Monday push

Apple Developer → Certificates, IDs & Profiles → Keys → new key with APNs
enabled. Download the `.p8` once. `APNS_KEY_ID` = the key id, `APNS_TEAM_ID` =
your team id, `APNS_KEY_P8` = the file contents (paste with literal `\n` or as
multi-line env var), `APNS_ENV` = `development` for TestFlight/dev builds,
`production` for App Store.

## 6. First run on your phone (10 min + a week of wearing the watch)

1. Run on a physical device (HealthKit background delivery does not work in
   the simulator).
2. Onboard: consent → Sign in with Apple → grant Health permissions → targets.
3. In your food app (Cronometer/MacroFactor/MFP), make sure Apple Health
   *write* sync is on — Stage-1 exit gate: after a few days, the Today tab
   shows correct sleep/vitals/activity/nutrition with sync checkmarks.
4. Force a first review without waiting for Monday (backfills last week):
   ```sh
   curl -X POST "https://<your-api>/internal/coach/run" -H "x-cron-secret: $CRON_SECRET"
   ```
   Then pull-to-refresh the Review tab. Check `coach_runs` in Supabase for
   tokens/cost/status.

## 7. TestFlight (when ready)

Archive in Xcode → App Store Connect. Before any distribution beyond yourself:
fill the placeholders in `docs/privacy/health-data-privacy-policy.md` (contact
email, effective date, hosted URL), host it, and complete App Store privacy
labels (Health & Fitness data, linked to identity, not used for tracking).

## Known environment notes

- The build session's sandbox blocked SwiftPM/xcodebuild (nested-sandbox
  denial) and socket binding; that's why step 0 exists. All TypeScript was
  fully verified in-session (99 tests, strict typecheck).
- `weekly_checkins` sync from the phone: check-ins save locally and sync via
  `/v1/sync/checkins`.
- Deleting the app does not delete server data — use Settings → Delete account
  (that's the compliant path).
