import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../src/app.js";
import { supabaseVerifier } from "../src/middleware/auth.js";
import { exportAccount, deleteAccountRows } from "../src/services/accountService.js";
import { FakeDb, TEST_USER, fakeVerify, call } from "./helpers.js";

describe("supabase token verification", () => {
  const secret = "super-secret-jwt-signing-key-for-tests";

  it("accepts a valid HS256 token and returns sub", async () => {
    const token = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(TEST_USER)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    const verify = supabaseVerifier(secret);
    await expect(verify(token)).resolves.toBe(TEST_USER);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(TEST_USER)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret"));
    const verify = supabaseVerifier(secret);
    await expect(verify(token)).rejects.toThrow();
  });
});

describe("account rights", () => {
  it("export reads every user table", async () => {
    const db = new FakeDb();
    const dump = await exportAccount(db, TEST_USER);
    // Every read is scoped to the user and the export covers all root tables
    // plus joined children.
    expect(db.calls.every(c => c.params?.[0] === TEST_USER)).toBe(true);
    for (const table of ["profiles", "sleep_daily", "vitals_daily", "activity_daily",
                         "nutrition_daily", "body_metrics", "workouts", "habits",
                         "biomarker_panels", "weekly_checkins", "weekly_summaries",
                         "coach_runs", "habit_logs", "biomarker_results", "recommendations"]) {
      expect(dump).toHaveProperty(table);
    }
  });

  it("delete removes rows from every root table", async () => {
    const db = new FakeDb();
    await deleteAccountRows(db, TEST_USER);
    const deletes = db.calls.filter(c => c.text.startsWith("delete from"));
    expect(deletes.length).toBeGreaterThanOrEqual(12);
    expect(deletes.every(c => c.params?.[0] === TEST_USER)).toBe(true);
  });

  it("DELETE /v1/account deletes rows then the auth user", async () => {
    const db = new FakeDb();
    let authDeleted: string | null = null;
    const app = buildApp({
      db,
      verifyToken: fakeVerify,
      deleteAuthUser: async (id) => { authDeleted = id; },
      cronSecret: "test-cron-secret-0123456789",
    });
    const res = await call(app, { method: "DELETE", url: "/v1/account", headers: { authorization: "Bearer good" } });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(authDeleted).toBe(TEST_USER);
  });
});
