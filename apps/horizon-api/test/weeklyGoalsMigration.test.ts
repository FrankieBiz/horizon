import { describe, expect, it } from "vitest";
import { ensureWeeklyGoalsSchema } from "../src/db/weeklyGoalsMigration.js";
import { FakeDb } from "./helpers.js";

describe("weekly goals startup migration", () => {
  it("applies the migration when the table is absent and verifies it", async () => {
    const db = new FakeDb().script(
      { rows: [] }, { rows: [{ goal_table: null }] },
      { rows: [] }, { rows: [{ ready: true }] });
    await ensureWeeklyGoalsSchema(async (run) => run(db));
    expect(db.calls[2]!.text).toContain("create table weekly_goals");
    expect(db.calls[3]!.text).toContain("weekly_goals_one_main_per_week");
  });

  it("does not replay an existing migration", async () => {
    const db = new FakeDb().script(
      { rows: [] }, { rows: [{ goal_table: "weekly_goals" }] },
      { rows: [{ ready: true }] });
    await ensureWeeklyGoalsSchema(async (run) => run(db));
    expect(db.calls).toHaveLength(3);
  });

  it("refuses startup when an existing schema is incomplete", async () => {
    const db = new FakeDb().script(
      { rows: [] }, { rows: [{ goal_table: "weekly_goals" }] },
      { rows: [{ ready: false }] });
    await expect(ensureWeeklyGoalsSchema(async (run) => run(db)))
      .rejects.toThrow("schema is incomplete");
  });
});
