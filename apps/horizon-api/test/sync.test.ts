import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { upsertSleepDays, upsertNutritionDays, upsertBiomarkerPanels } from "../src/services/syncService.js";
import { FakeDb, TEST_USER, fakeVerify, call } from "./helpers.js";

function appWith(db: FakeDb) {
  return buildApp({
    db,
    verifyToken: fakeVerify,
    deleteAuthUser: async () => {},
    cronSecret: "test-cron-secret-0123456789",
  });
}

describe("sync services", () => {
  it("sleep upsert enforces manual-wins conflict rule", async () => {
    const db = new FakeDb().script({ rowCount: 1 });
    const n = await upsertSleepDays(db, TEST_USER, [{
      local_date: "2026-07-06", total_min: 435, in_bed_min: 480,
      deep_min: 60, rem_min: 90, core_min: 285, awake_min: 20,
      bedtime_at: "2026-07-06T03:00:00Z", waketime_at: "2026-07-06T11:00:00Z",
      source: "healthkit",
    }]);
    expect(n).toBe(1);
    const sql = db.calls[0]!.text;
    expect(sql).toContain("on conflict (user_id, local_date)");
    expect(sql).toContain("not (sleep_daily.source = 'manual' and excluded.source = 'healthkit')");
    expect(db.calls[0]!.params![0]).toBe(TEST_USER);
  });

  it("healthkit write over a manual row reports zero upserts (no-op)", async () => {
    const db = new FakeDb().script({ rowCount: 0 }); // WHERE clause suppressed the update
    const n = await upsertNutritionDays(db, TEST_USER, [{
      local_date: "2026-07-06", calories_kcal: 2200, protein_g: 140,
      carbs_g: null, fat_g: null, water_ml: null,
      source: "healthkit", is_complete: false,
    }]);
    expect(n).toBe(0);
  });

  it("biomarker panel upsert replaces results wholesale", async () => {
    const db = new FakeDb().script(
      { rows: [{ id: "panel-1" }], rowCount: 1 }, // panel upsert
      { rowCount: 1 }, // delete old results
      { rowCount: 1 }, // insert result 1
      { rowCount: 1 }, // insert result 2
    );
    const n = await upsertBiomarkerPanels(db, TEST_USER, [{
      client_id: "c-1", drawn_on: "2026-06-20", lab_name: "Quest", notes: null,
      results: [
        { marker: "LDL-C", value: 128, unit: "mg/dL", ref_low: 0, ref_high: 99, lab_flag: "H" },
        { marker: "HbA1c", value: 5.2, unit: "%", ref_low: 4.0, ref_high: 5.6, lab_flag: null },
      ],
    }]);
    expect(n).toBe(1);
    expect(db.calls[1]!.text).toContain("delete from biomarker_results");
    expect(db.calls.filter(c => c.text.includes("insert into biomarker_results"))).toHaveLength(2);
  });
});

describe("sync routes", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await call(appWith(new FakeDb()), {
      method: "POST", url: "/v1/sync/sleep", payload: { days: [] },
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthenticated");
  });

  it("rejects invalid payloads with 400 validation", async () => {
    const res = await call(appWith(new FakeDb()), {
      method: "POST", url: "/v1/sync/vitals",
      headers: { authorization: "Bearer good" },
      payload: { days: [{ local_date: "07/06/2026", source: "healthkit" }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
  });

  it("accepts a valid activity batch", async () => {
    const db = new FakeDb().script({ rowCount: 1 }, { rowCount: 1 });
    const res = await call(appWith(db), {
      method: "POST", url: "/v1/sync/activity",
      headers: { authorization: "Bearer good" },
      payload: {
        days: [
          { local_date: "2026-07-05", steps: 9000, active_energy_kcal: 620, exercise_min: 34, source: "healthkit" },
          { local_date: "2026-07-06", steps: 4200, active_energy_kcal: 300, exercise_min: 5, source: "healthkit" },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.upserted).toBe(2);
  });

  it("accepts a weekly check-in", async () => {
    const db = new FakeDb().script({ rowCount: 1 });
    const res = await call(appWith(db), {
      method: "POST", url: "/v1/sync/checkins",
      headers: { authorization: "Bearer good" },
      payload: { checkins: [{ week_start: "2026-06-29", energy: 4, soreness: 2, sleep_quality: 4 }] },
    });
    expect(res.status).toBe(200);
    expect(res.body.upserted).toBe(1);
  });

  it("rejects out-of-range checkin values", async () => {
    const res = await call(appWith(new FakeDb()), {
      method: "POST", url: "/v1/sync/checkins",
      headers: { authorization: "Bearer good" },
      payload: { checkins: [{ week_start: "2026-06-29", energy: 9, soreness: 2, sleep_quality: 4 }] },
    });
    expect(res.status).toBe(400);
  });
});

describe("internal cron route", () => {
  it("requires the cron secret", async () => {
    const res = await call(appWith(new FakeDb()), {
      method: "POST", url: "/internal/coach/run",
    });
    expect(res.status).toBe(401);
  });

  it("503s until the coach runner is wired (Stage 4)", async () => {
    const res = await call(appWith(new FakeDb()), {
      method: "POST", url: "/internal/coach/run",
      headers: { "x-cron-secret": "test-cron-secret-0123456789" },
    });
    expect(res.status).toBe(503);
  });
});
