import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FakeDb, TEST_USER, fakeVerify, call } from "./helpers.js";

const goal = {
  goal_id: "22222222-2222-4222-8222-222222222222",
  week_start: "2026-09-21",
  title: "Write four essays",
  category: "School",
  is_main: true,
  is_deleted: false,
  revision: 0,
  steps: [
    { id: "33333333-3333-4333-8333-333333333333", title: "Essay 1", is_complete: true },
    { id: "44444444-4444-4444-8444-444444444444", title: "Essay 2", is_complete: false },
  ],
};

function appWith(db: FakeDb) {
  return buildApp({ db, verifyToken: fakeVerify,
    deleteAuthUser: async () => {}, cronSecret: "test-cron-secret-0123456789" });
}

describe("weekly goals", () => {
  it("stores multiple goals for one category without replacing each other", async () => {
    const db = new FakeDb().script(
      { rows: [{}] }, { rows: [] },
      { rows: [{ revision: 1 }] }, { rows: [{ revision: 1 }] });
    const second = { ...goal, goal_id: "55555555-5555-4555-8555-555555555555", title: "Read a book", is_main: false };
    const res = await call(appWith(db), {
      method: "POST", url: "/v1/sync/weekly-goals",
      headers: { authorization: "Bearer good" }, payload: { goals: [goal, second] },
    });
    expect(res.status).toBe(200);
    expect(res.body.upserted).toBe(2);
    expect(res.body.revisions).toHaveLength(2);
    expect(db.calls).toHaveLength(4);
    expect(db.calls[0]!.text).toContain("pg_advisory_xact_lock");
    expect(db.calls[1]!.text).toContain("set is_main = false");
    expect(db.calls[2]!.params![0]).toBe(TEST_USER);
    expect(db.calls[2]!.text).toContain("on conflict (user_id, goal_id)");
  });

  it("rejects empty goals and malformed steps", async () => {
    const db = new FakeDb();
    const res = await call(appWith(db), {
      method: "POST", url: "/v1/sync/weekly-goals",
      headers: { authorization: "Bearer good" },
      payload: { goals: [{ ...goal, steps: [{ title: "" }] }] },
    });
    expect(res.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it("returns only the signed-in user's goals", async () => {
    const db = new FakeDb().script({ rows: [goal], rowCount: 1 });
    const res = await call(appWith(db), {
      method: "GET", url: "/v1/weekly-goals", headers: { authorization: "Bearer good" },
    });
    expect(res.status).toBe(200);
    expect(res.body.goals).toHaveLength(1);
    expect(db.calls[0]!.params).toEqual([TEST_USER]);
  });

  it("accepts tombstones with no steps", async () => {
    const db = new FakeDb().script({ rows: [{ revision: 2 }] });
    const res = await call(appWith(db), {
      method: "POST", url: "/v1/sync/weekly-goals",
      headers: { authorization: "Bearer good" },
      payload: { goals: [{ ...goal, is_deleted: true, steps: [] }] },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a stale revision without replacing newer progress", async () => {
    const db = new FakeDb().script({ rows: [], rowCount: 0 });
    const res = await call(appWith(db), {
      method: "POST", url: "/v1/sync/weekly-goals",
      headers: { authorization: "Bearer good" },
      payload: { goals: [{ ...goal, is_main: false, revision: 1 }] },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("goal_conflict");
    expect(db.calls[0]!.text).toContain("where weekly_goals.revision = $9");
  });
});
