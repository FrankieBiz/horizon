import type { Queryable } from "../db/pool.js";
import { computeBaselines, computeFindings, type WeekRows } from "../analysis/findings.js";
import type { WeeklyData } from "./schemas.js";

// Assembles one user's WeeklyData: 7 days of domain rows + 56 days of history
// for baselines + habit adherence + biomarker flags + last week's review.
// All date math happens in SQL against local_date (already user-timezone).

function iso(d: unknown): string {
  return d instanceof Date ? d.toISOString() : String(d);
}
function day(d: unknown): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function addDays(localDate: string, n: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** UTC instant of local midnight for a LocalDate in a timezone (DST-safe,
 * two-pass). Workouts are stored as instants, so their week windows must be
 * built from the user's local boundaries, not UTC date casts (review finding). */
export function zonedMidnightUtc(localDate: string, timeZone: string): Date {
  const [y, m, d] = localDate.split("-").map(Number);
  const desired = Date.UTC(y!, m! - 1, d!); // target wall-clock, read as UTC
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  // instant = desired - offset(instant); iterate once more for DST edges.
  let instant = desired;
  for (let i = 0; i < 2; i++) {
    const parts = fmt.formatToParts(new Date(instant));
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"),
                               get("hour") % 24, get("minute"), get("second"));
    const offset = wallAsUtc - instant;
    const next = desired - offset;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant);
}

export async function assembleWeeklyData(
  db: Queryable, userId: string, weekStart: string
): Promise<WeeklyData> {
  const profileRes = await db.query(
    `select timezone, goals_json from profiles where user_id = $1`, [userId]);
  const profile = profileRes.rows[0] ?? { timezone: "America/New_York", goals_json: {} };
  const goals = profile.goals_json ?? {};

  const tz = profile.timezone ?? "America/New_York";
  // 60-day history window — must be >= the baseline-ready gate in findings.ts
  // (review finding: a 56-day window made the recovery pathway unreachable).
  const weekEnd = `(($2::date) + interval '6 days')::date`;
  const histStart = `(($2::date) - interval '60 days')::date`;
  // Workout tables store instants; window them by the user's LOCAL week.
  const weekStartInstant = zonedMidnightUtc(weekStart, tz).toISOString();
  const weekEndInstant = zonedMidnightUtc(addDays(weekStart, 7), tz).toISOString();
  const chronicStartInstant = zonedMidnightUtc(addDays(weekStart, -28), tz).toISOString();

  const [sleep, vitals, activity, nutrition, body, workouts] = await Promise.all([
    db.query(`select * from sleep_daily where user_id = $1 and local_date between $2::date and ${weekEnd} order by local_date`, [userId, weekStart]),
    db.query(`select * from vitals_daily where user_id = $1 and local_date between $2::date and ${weekEnd} order by local_date`, [userId, weekStart]),
    db.query(`select * from activity_daily where user_id = $1 and local_date between $2::date and ${weekEnd} order by local_date`, [userId, weekStart]),
    db.query(`select * from nutrition_daily where user_id = $1 and local_date between $2::date and ${weekEnd} order by local_date`, [userId, weekStart]),
    db.query(`select * from body_metrics where user_id = $1 and local_date between $2::date and ${weekEnd} order by local_date`, [userId, weekStart]),
    db.query(`select * from workouts where user_id = $1 and start_at >= $2::timestamptz and start_at < $3::timestamptz order by start_at`, [userId, weekStartInstant, weekEndInstant]),
  ]);

  const [histVitals, histSleep, histActivity, histWorkouts, lastWorkout, weekTimezones] = await Promise.all([
    db.query(`select local_date, resting_hr, hrv_sdnn_ms from vitals_daily where user_id = $1 and local_date >= ${histStart} and local_date < $2::date order by local_date`, [userId, weekStart]),
    db.query(`select local_date, total_min from sleep_daily where user_id = $1 and local_date >= ${histStart} and local_date < $2::date order by local_date`, [userId, weekStart]),
    db.query(`select local_date, steps from activity_daily where user_id = $1 and local_date >= ${histStart} and local_date < $2::date order by local_date`, [userId, weekStart]),
    db.query(`select start_at, duration_min, avg_hr from workouts where user_id = $1 and start_at >= $2::timestamptz and start_at < $3::timestamptz order by start_at`, [userId, chronicStartInstant, weekStartInstant]),
    db.query(`select max(start_at) as last from workouts where user_id = $1 and start_at < $2::timestamptz`, [userId, weekEndInstant]),
    // Travel detection: habit logs record the device timezone at write time —
    // the one per-day tz signal the schema has (review finding: was hardcoded).
    db.query(`select distinct timezone from habit_logs where user_id = $1 and local_date between $2::date and ${weekEnd}`, [userId, weekStart]),
  ]);

  // ---- Habits: due/done this week + 30d adherence ----
  const habitsRes = await db.query(
    `select h.id, h.name, h.kind, s.frequency_type, s.freq_numerator, s.freq_denominator,
            s.weekday_mask, s.interval_days
       from habits h
       left join habit_schedules s on s.habit_id = h.id
      where h.user_id = $1 and h.archived_at is null
      order by h.created_at`, [userId]);
  const habitLogsWeek = await db.query(
    `select habit_id, local_date from habit_logs
      where user_id = $1 and local_date between $2::date and ${weekEnd}`, [userId, weekStart]);
  const habitLogs30 = await db.query(
    `select habit_id, count(*)::int as done from habit_logs
      where user_id = $1 and local_date >= ($2::date - interval '30 days') and local_date < $2::date
      group by habit_id`, [userId, weekStart]);

  const doneThisWeek = new Map<string, number>();
  for (const row of habitLogsWeek.rows) {
    doneThisWeek.set(row.habit_id, (doneThisWeek.get(row.habit_id) ?? 0) + 1);
  }
  const done30 = new Map<string, number>(habitLogs30.rows.map((r: any) => [r.habit_id, r.done]));

  function dueDaysPerWeek(h: any): number {
    switch (h.frequency_type) {
      case "daily": return 7;
      case "n_times_per_week": return Math.min(7, h.freq_numerator ?? 1);
      case "specific_weekdays": {
        let bits = h.weekday_mask ?? 0, count = 0;
        while (bits) { count += bits & 1; bits >>= 1; }
        return count;
      }
      case "interval_days": return h.interval_days ? Math.max(1, Math.round(7 / h.interval_days)) : 7;
      case "as_needed": return 0; // excluded from adherence (spec decision)
      default: return 7;
    }
  }

  const habits = habitsRes.rows.map((h: any) => {
    const due = dueDaysPerWeek(h);
    const done = doneThisWeek.get(h.id) ?? 0;
    const due30 = due === 0 ? 0 : Math.round((due / 7) * 30);
    const d30 = done30.get(h.id) ?? 0;
    return {
      name: h.name,
      kind: (h.kind ?? "habit") as "habit" | "supplement",
      due_days: due,
      done_days: done,
      adherence_week_pct: due === 0 ? null : Math.min(100, Math.round((done / due) * 100)),
      adherence_30d_pct: due30 === 0 ? null : Math.min(100, Math.round((d30 / due30) * 100)),
    };
  });

  // ---- Check-in (last week's, shown when review opens) ----
  const checkinRes = await db.query(
    `select week_start, energy, soreness, sleep_quality from weekly_checkins
      where user_id = $1 and week_start = $2::date`, [userId, weekStart]);

  // ---- Biomarkers: panels since the last summary + trend across panels ----
  const lastSummaryRes = await db.query(
    `select week_start, coach_message, created_at from weekly_summaries
      where user_id = $1 and week_start < $2::date
      order by week_start desc limit 1`, [userId, weekStart]);
  const lastSummary = lastSummaryRes.rows[0];
  const lastRecsRes = lastSummary
    ? await db.query(
        `select r.category, r.message, r.status from recommendations r
           join weekly_summaries ws on ws.id = r.weekly_summary_id
          where ws.user_id = $1 and ws.week_start = $2
          order by r.priority`, [userId, day(lastSummary.week_start)])
    : { rows: [], rowCount: 0 };

  const sinceClause = lastSummary ? `and p.created_at > $2` : "";
  const newPanels = await db.query(
    `select count(*)::int as n from biomarker_panels p
      where p.user_id = $1 ${sinceClause}`,
    lastSummary ? [userId, lastSummary.created_at] : [userId]);
  const hasNewPanel = (newPanels.rows[0]?.n ?? 0) > 0;

  const flagsRes = await db.query(
    `select r.marker, r.value, r.unit, r.ref_low, r.ref_high, p.drawn_on,
            row_number() over (partition by r.marker order by p.drawn_on desc) as rn,
            lag(r.value) over (partition by r.marker order by p.drawn_on) as prev_value,
            count(*) over (partition by r.marker) as panel_count
       from biomarker_results r
       join biomarker_panels p on p.id = r.panel_id
      where p.user_id = $1
      order by p.drawn_on desc`, [userId]);
  const latestPerMarker = flagsRes.rows.filter((r: any) => Number(r.rn) === 1);
  const flags = latestPerMarker.map((r: any) => {
    const outOfRange =
      (r.ref_low != null && r.value < Number(r.ref_low)) ||
      (r.ref_high != null && r.value > Number(r.ref_high));
    let trend: "first_panel" | "rising" | "falling" | "stable" | null = null;
    if (Number(r.panel_count) <= 1) trend = "first_panel";
    else if (r.prev_value != null) {
      const delta = (r.value - Number(r.prev_value)) / Math.abs(Number(r.prev_value) || 1);
      trend = delta > 0.05 ? "rising" : delta < -0.05 ? "falling" : "stable";
    }
    return {
      marker: r.marker, value: Number(r.value), unit: r.unit,
      ref_low: r.ref_low == null ? null : Number(r.ref_low),
      ref_high: r.ref_high == null ? null : Number(r.ref_high),
      out_of_range: outOfRange, drawn_on: day(r.drawn_on), trend,
    };
  });

  // ---- Rules engine ----
  const weekRows: WeekRows = {
    weekStart,
    timezone: profile.timezone,
    sleepNeedMin: goals.sleep_need_min ?? 450,
    proteinTargetG: goals.protein_target_g ?? null,
    sleep: sleep.rows.map((r: any) => ({
      local_date: day(r.local_date), total_min: r.total_min,
      bedtime_at: r.bedtime_at ? iso(r.bedtime_at) : null,
    })),
    vitals: vitals.rows.map((r: any) => ({
      local_date: day(r.local_date), resting_hr: r.resting_hr, hrv_sdnn_ms: r.hrv_sdnn_ms,
    })),
    activity: activity.rows.map((r: any) => ({
      local_date: day(r.local_date), steps: r.steps, exercise_min: r.exercise_min,
    })),
    nutrition: nutrition.rows.map((r: any) => ({
      local_date: day(r.local_date), calories_kcal: r.calories_kcal,
      protein_g: r.protein_g, is_complete: r.is_complete,
    })),
    workouts: workouts.rows.map((r: any) => ({
      start_at: iso(r.start_at), duration_min: Number(r.duration_min), avg_hr: r.avg_hr,
    })),
    habits,
    timezones: [...new Set([
      profile.timezone,
      ...weekTimezones.rows.map((r: any) => r.timezone).filter(Boolean),
    ])],
    historyVitals: histVitals.rows.map((r: any) => ({
      local_date: day(r.local_date), resting_hr: r.resting_hr, hrv_sdnn_ms: r.hrv_sdnn_ms,
    })),
    historySleep: histSleep.rows.map((r: any) => ({
      local_date: day(r.local_date), total_min: r.total_min,
    })),
    historyActivity: histActivity.rows.map((r: any) => ({
      local_date: day(r.local_date), steps: r.steps,
    })),
    historyWorkouts: histWorkouts.rows.map((r: any) => ({
      start_at: iso(r.start_at), duration_min: Number(r.duration_min), avg_hr: r.avg_hr,
    })),
    weeksSinceLastWorkout: lastWorkout.rows[0]?.last
      ? Math.floor((new Date(weekEndInstant).getTime() -
                    new Date(lastWorkout.rows[0].last).getTime()) / (7 * 86400e3))
      : null,
  };

  const baselines = computeBaselines(weekRows);
  const findings = computeFindings(weekRows, baselines);

  return {
    week_start: weekStart,
    timezone: profile.timezone,
    profile: {
      sleep_need_min: goals.sleep_need_min ?? 450,
      protein_target_g: goals.protein_target_g ?? null,
      calorie_target_kcal: goals.calorie_target_kcal ?? null,
      weekly_workout_target: goals.weekly_workout_target ?? null,
      primary_goal: goals.primary_goal ?? "longevity",
    },
    week: {
      sleep: sleep.rows.map((r: any) => ({
        local_date: day(r.local_date), total_min: r.total_min, in_bed_min: r.in_bed_min,
        deep_min: r.deep_min, rem_min: r.rem_min, core_min: r.core_min, awake_min: r.awake_min,
        bedtime_at: r.bedtime_at ? iso(r.bedtime_at) : null,
        waketime_at: r.waketime_at ? iso(r.waketime_at) : null,
        source: r.source,
      })),
      vitals: vitals.rows.map((r: any) => ({
        local_date: day(r.local_date), resting_hr: r.resting_hr,
        hrv_sdnn_ms: r.hrv_sdnn_ms, respiratory_rate: r.respiratory_rate, source: r.source,
      })),
      activity: activity.rows.map((r: any) => ({
        local_date: day(r.local_date), steps: r.steps,
        active_energy_kcal: r.active_energy_kcal, exercise_min: r.exercise_min, source: r.source,
      })),
      nutrition: nutrition.rows.map((r: any) => ({
        local_date: day(r.local_date), calories_kcal: r.calories_kcal, protein_g: r.protein_g,
        carbs_g: r.carbs_g, fat_g: r.fat_g, water_ml: r.water_ml,
        source: r.source, is_complete: r.is_complete,
      })),
      body: body.rows.map((r: any) => ({
        local_date: day(r.local_date), weight_kg: r.weight_kg,
        body_fat_pct: r.body_fat_pct, source: r.source,
      })),
      workouts: workouts.rows.map((r: any) => ({
        sync_identifier: r.sync_identifier, workout_type: r.workout_type,
        start_at: iso(r.start_at), end_at: iso(r.end_at),
        duration_min: Number(r.duration_min), active_kcal: r.active_kcal,
        avg_hr: r.avg_hr, distance_m: r.distance_m, source: r.source,
      })),
      habits,
      checkin: checkinRes.rows[0]
        ? {
            week_start: day(checkinRes.rows[0].week_start),
            energy: checkinRes.rows[0].energy,
            soreness: checkinRes.rows[0].soreness,
            sleep_quality: checkinRes.rows[0].sleep_quality,
          }
        : null,
    },
    baselines,
    findings,
    biomarkers: { new_panel: hasNewPanel, flags: hasNewPanel ? flags : [] },
    last_week: {
      coach_message: lastSummary?.coach_message ?? null,
      recommendations: lastRecsRes.rows,
    },
  };
}
