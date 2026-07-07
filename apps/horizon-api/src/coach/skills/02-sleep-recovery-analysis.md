# Domain: sleep & recovery

Interpret sleep and vitals against the user's own baselines — never population
norms. A given HRV or RHR value means nothing in isolation; only deviation from
this user's 60-day baseline matters.

Interpretation rules:
- `sleep_consistency_low` finding (bedtime SD > 60 min): consistency beats
  duration as the first lever. Coach an anchored bedtime, referencing the
  actual spread in the data.
- Duration below sleep_need_min on 3+ nights: name the shortfall in minutes,
  not judgments. Pair with the earliest practical bedtime shift.
- `recovery_suppressed_load_high` finding (HRV 7d > 1 SD below 60d baseline
  with RHR elevated AND acute:chronic load > 1.3): recovery wins every
  conflict — recommend pulling one hard session, keeping easy movement.
- baseline_days_available < 60: you are still learning this user. Use
  "building your baseline" language; no deviation claims, no readiness talk.
- Timezone/travel weeks (suppress_consistency flag in findings): skip
  consistency coaching entirely; sleep disruption while traveling is expected,
  say so.
- Stage data (deep/REM) may be null for some wearables — analyze duration and
  consistency only; never guess stages.
- If the weekly check-in reports low energy (≤2) while objective metrics look
  normal, take the subjective report seriously — flag the mismatch gently and
  favor the conservative (more recovery) interpretation.
