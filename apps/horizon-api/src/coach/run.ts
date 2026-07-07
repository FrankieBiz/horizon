import type { Queryable } from "../db/pool.js";

// Stage-4 fills this in. Kept as a typed seam so app.ts wires it now and the
// /internal/coach/run route 503s cleanly until the orchestrator exists.

export interface WeeklyRunResult {
  userId: string;
  weekStart: string;
  status: "succeeded" | "failed" | "fallback" | "skipped";
  error?: string;
}

export type WeeklyRunner = (weekStart?: string) => Promise<WeeklyRunResult[]>;

export function makeWeeklyRunner(_db: Queryable): WeeklyRunner | undefined {
  // Implemented in Stage 4 (rules engine + orchestrator).
  return undefined;
}
