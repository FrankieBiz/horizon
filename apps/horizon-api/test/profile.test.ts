import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { updateProfile } from "../src/services/profileService.js";
import { FakeDb, TEST_USER, fakeVerify, call } from "./helpers.js";

function appWith(db: FakeDb) {
  return buildApp({
    db, verifyToken: fakeVerify,
    deleteAuthUser: async () => {},
    cronSecret: "test-cron-secret-0123456789",
  });
}

describe("profile", () => {
  it("merges goals into goals_json instead of replacing", async () => {
    const db = new FakeDb().script({ rowCount: 1 });
    await updateProfile(db, TEST_USER, { goals: { protein_target_g: 160 } });
    const sql = db.calls[0]!.text;
    expect(sql).toContain("goals_json = profiles.goals_json || coalesce($3::jsonb");
    expect(sql).toContain("apns_token = coalesce($4, profiles.apns_token)");
  });

  it("PUT /v1/profile validates goal ranges", async () => {
    const res = await call(appWith(new FakeDb()), {
      method: "PUT", url: "/v1/profile",
      headers: { authorization: "Bearer good" },
      payload: { goals: { sleep_need_min: 10 } },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation");
  });

  it("PUT /v1/profile accepts timezone + apns token + goals", async () => {
    const db = new FakeDb().script({ rowCount: 1 });
    const res = await call(appWith(db), {
      method: "PUT", url: "/v1/profile",
      headers: { authorization: "Bearer good" },
      payload: {
        timezone: "America/New_York",
        apns_token: "a".repeat(64),
        goals: { sleep_need_min: 450, protein_target_g: 150 },
      },
    });
    expect(res.status).toBe(200);
    expect(db.calls[0]!.params![0]).toBe(TEST_USER);
  });
});
