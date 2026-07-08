# Horizon Health Data Privacy Policy

> **STATUS: DRAFT v1 (2026-07-07) — not yet published.** Written to satisfy the
> Washington My Health My Data Act's requirement for a *standalone* consumer health
> data privacy policy (separate from any general privacy policy), Apple App Store
> Review Guideline 5.1.3, and the FTC Health Breach Notification Rule. Requires a
> final read-through (and ideally counsel review) before the app is distributed
> beyond personal use. Placeholders are marked with ⟪⟫.

**Effective date:** ⟪set at publication⟫
**Contact:** ⟪support email — set before publishing⟫

This policy covers only your health data in Horizon. It applies to everyone who uses
Horizon, and it is intentionally separate from any general privacy policy so that how
we handle health data is stated in one place, completely.

## 1. The health data Horizon collects

**Read from Apple Health, only with your explicit permission, and only these types:**

| Category | Exact data types |
|---|---|
| Sleep | Sleep analysis (time in bed, asleep, sleep stages where available), bed/wake times |
| Heart | Resting heart rate; heart rate variability (SDNN); respiratory rate |
| Activity | Step count; active energy burned; exercise minutes; workouts (type, start/end, duration, calories, average heart rate, distance) |
| Nutrition | Dietary energy (calories); protein; carbohydrates; fat; water |

**Entered by you in the app (optional):** daily nutrition totals; habits and
supplement logs (name, dose, schedule, completion); body metrics (weight, body-fat
%); blood test results you choose to type in (marker, value, unit, and your lab's
reference range); a weekly 3-item check-in (energy, soreness, sleep quality); your
goals (e.g., sleep target, protein target).

Horizon stores **daily summaries**, not your raw continuous sensor stream. We collect
the minimum needed to write your weekly review.

## 2. What your health data is used for

One purpose: **generating your own weekly coaching review and showing you your own
trends.** Concretely, that means storing your daily summaries, computing your personal
baselines, and sending the relevant week of data to our AI service provider to write
your coaching message.

Your health data is **never** used for advertising, marketing, or "data mining"; never
used to build profiles for anyone but you; never sold; and never shared with data
brokers. Horizon contains no advertising or third-party analytics SDKs, and no health
data is ever placed in iCloud or in the text of push notifications.

## 3. Who processes your health data (the complete list)

Under the Washington My Health My Data Act you have the right to know every third
party your consumer health data is shared with. This is the complete list — all are
service providers acting on our instructions, none may use your data for their own
purposes:

| Processor | Role | What they receive |
|---|---|---|
| Supabase | Database hosting | Your stored health data (encrypted in transit and at rest) |
| Render | Server hosting | Health data transiting our backend |
| DeepSeek | AI processing (generates the weekly coaching message) | The week of data needed to write your coaching review. **DeepSeek is operated from China**; data processed there is subject to that jurisdiction. This is the app's configured AI processor (`LLM_PROVIDER=deepseek`); if switched to Anthropic, that provider (US) replaces this row. |
| Apple | Push notifications | **No health data** — notification payloads contain none |

No other third party receives your health data. If this list ever changes, the policy
will be updated and re-consented before the change takes effect.

## 4. Consent

Horizon asks for your **opt-in consent** at onboarding before collecting any health
data, separately from Apple's own HealthKit permission prompts. You can withdraw
consent at any time in Settings; withdrawal stops collection immediately and you can
then delete your data (below). Declining consent means Horizon simply doesn't collect
health data — the app will not nag you.

## 5. Your rights (available to everyone, not just Washington residents)

- **Access / export:** download everything Horizon holds about you as a machine-readable
  file (JSON), from Settings, at any time.
- **Deletion:** delete your account and all associated health data — every table,
  including backups within our providers' standard backup-expiry windows — from
  Settings, at any time. This is immediate and irreversible.
- **Withdraw consent:** stop all collection without deleting your account.
- **List of recipients:** the complete processor list in §3.

No fee, no friction, no "email us and wait" — these are buttons in the app.

## 6. Security

TLS for all data in transit; encryption at rest in the database; row-level security so
each account can only ever read its own rows; server credentials never shipped in the
app. Access to production data is limited to the operator of the service.

## 7. Breach notification

If unsecured health data is ever exposed, we will notify affected users and the FTC as
required by the FTC Health Breach Notification Rule (16 CFR Part 318) — individual
notice without unreasonable delay and within 60 days at the outside, stating what
happened, what data was involved, and what we're doing about it.

## 8. Retention

Health data is kept while your account is active, so your baselines and trends work.
Deleted on account deletion (§5). We don't keep what we don't need: raw continuous
samples are never uploaded in the first place.

## 9. What Horizon is not

Horizon provides general wellness information. It is not a medical device, does not
provide medical advice, diagnosis, or treatment, and is not a substitute for care from
a qualified professional. Coaching messages are generated from your own data for
wellness purposes only.

## 10. Changes to this policy

Material changes are announced in-app and require fresh consent before newly collected
data is handled under the new terms. The current version always lives at
⟪published policy URL⟫, and the change history is in the project repository.
