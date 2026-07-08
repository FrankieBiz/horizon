import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { syncRequests } from "@horizon/shared";
import type { Queryable } from "./db/pool.js";
import { requireAuth, requireCronSecret, type TokenVerifier } from "./middleware/auth.js";
import * as sync from "./services/syncService.js";
import * as account from "./services/accountService.js";
import type { AuthAdminDeleter } from "./services/accountService.js";
import { getReview, markRecommendation } from "./services/reviewService.js";
import type { WeeklyRunner } from "./coach/run.js";

export interface AppDeps {
  db: Queryable;
  verifyToken: TokenVerifier;
  deleteAuthUser: AuthAdminDeleter;
  cronSecret: string;
  /** Injected in Stage 4; the route 503s until then if absent. */
  runWeekly?: WeeklyRunner;
  /** Transaction wrapper; account deletion must be all-or-nothing.
   * Defaults to non-transactional passthrough (tests). */
  withTx?: <T>(run: (tx: Queryable) => Promise<T>) => Promise<T>;
}

/** Build the app with injected dependencies — tests pass fakes. */
export function buildApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const authed = requireAuth(deps.verifyToken);

  // ---- Sync (per-domain idempotent upserts) ----
  const syncRoutes: Array<{
    path: string;
    schema: (typeof syncRequests)[keyof typeof syncRequests];
    handler: (db: Queryable, userId: string, body: any) => Promise<number>;
  }> = [
    { path: "sleep", schema: syncRequests.sleep, handler: (db, u, b) => sync.upsertSleepDays(db, u, b.days) },
    { path: "vitals", schema: syncRequests.vitals, handler: (db, u, b) => sync.upsertVitalsDays(db, u, b.days) },
    { path: "activity", schema: syncRequests.activity, handler: (db, u, b) => sync.upsertActivityDays(db, u, b.days) },
    { path: "nutrition", schema: syncRequests.nutrition, handler: (db, u, b) => sync.upsertNutritionDays(db, u, b.days) },
    { path: "body", schema: syncRequests.body, handler: (db, u, b) => sync.upsertBodyDays(db, u, b.days) },
    { path: "workouts", schema: syncRequests.workouts, handler: (db, u, b) => sync.upsertWorkouts(db, u, b.workouts) },
    { path: "habit-logs", schema: syncRequests.habitLogs, handler: (db, u, b) => sync.upsertHabitLogs(db, u, b.logs) },
    { path: "checkins", schema: syncRequests.checkins, handler: (db, u, b) => sync.upsertCheckins(db, u, b.checkins) },
  ];
  for (const r of syncRoutes) {
    app.post(`/v1/sync/${r.path}`, authed, async (req, res, next) => {
      try {
        const body = r.schema.parse(req.body);
        const upserted = await r.handler(deps.db, req.userId!, body);
        res.json({ upserted });
      } catch (e) {
        next(e);
      }
    });
  }

  app.post("/v1/biomarkers/panels", authed, async (req, res, next) => {
    try {
      const body = syncRequests.biomarkerPanels.parse(req.body);
      const upserted = await sync.upsertBiomarkerPanels(deps.db, req.userId!, body.panels);
      res.json({ upserted });
    } catch (e) {
      next(e);
    }
  });

  // ---- Profile (timezone, goals, APNs token) ----
  app.put("/v1/profile", authed, async (req, res, next) => {
    try {
      const { updateProfile, profileUpdate } = await import("./services/profileService.js");
      const body = profileUpdate.parse(req.body);
      await updateProfile(deps.db, req.userId!, body);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  app.get("/v1/profile", authed, async (req, res, next) => {
    try {
      const { getProfile } = await import("./services/profileService.js");
      const profile = await getProfile(deps.db, req.userId!);
      if (!profile) {
        res.status(404).json({ error: "no profile", code: "not_found" });
        return;
      }
      res.json(profile);
    } catch (e) {
      next(e);
    }
  });

  // ---- Weekly review ----
  app.get("/v1/reviews/latest", authed, async (req, res, next) => {
    try {
      const review = await getReview(deps.db, req.userId!);
      if (!review) {
        res.status(404).json({ error: "no review yet", code: "not_found" });
        return;
      }
      res.json(review);
    } catch (e) {
      next(e);
    }
  });

  app.get("/v1/reviews/:weekStart", authed, async (req, res, next) => {
    try {
      const review = await getReview(deps.db, req.userId!, String(req.params.weekStart));
      if (!review) {
        res.status(404).json({ error: "no review for that week", code: "not_found" });
        return;
      }
      res.json(review);
    } catch (e) {
      next(e);
    }
  });

  app.post("/v1/recommendations/:id/status", authed, async (req, res, next) => {
    try {
      const status = String(req.body?.status ?? "");
      if (!["read", "acted", "dismissed"].includes(status)) {
        res.status(400).json({ error: "invalid status", code: "validation" });
        return;
      }
      await markRecommendation(deps.db, req.userId!, String(req.params.id), status);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---- Account rights (export / delete — privacy policy §5) ----
  app.get("/v1/account/export", authed, async (req, res, next) => {
    try {
      const dump = await account.exportAccount(deps.db, req.userId!);
      res.setHeader("content-disposition", "attachment; filename=horizon-export.json");
      res.json({ exported_at: new Date().toISOString(), data: dump });
    } catch (e) {
      next(e);
    }
  });

  app.delete("/v1/account", authed, async (req, res, next) => {
    try {
      // All-or-nothing: a mid-sequence failure must not leave partial health
      // data behind (review finding).
      const withTx = deps.withTx ?? (<T,>(run: (tx: Queryable) => Promise<T>) => run(deps.db));
      await withTx((tx) => account.deleteAccountRows(tx, req.userId!));
      await deps.deleteAuthUser(req.userId!);
      res.json({ deleted: true });
    } catch (e) {
      next(e);
    }
  });

  // ---- Internal: cron-triggered weekly run ----
  app.post("/internal/coach/run", requireCronSecret(deps.cronSecret), async (req, res, next) => {
    try {
      if (!deps.runWeekly) {
        res.status(503).json({ error: "coach not configured", code: "unavailable" });
        return;
      }
      const week = typeof req.query.week === "string" ? req.query.week : undefined;
      const results = await deps.runWeekly(week);
      res.json({ results });
    } catch (e) {
      next(e);
    }
  });

  // ---- Errors: zod -> 400, everything else -> 500 (no health data in logs) ----
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        code: "validation",
      });
      return;
    }
    console.error("[horizon-api]", err instanceof Error ? err.message : "unknown error");
    res.status(500).json({ error: "internal error", code: "internal" });
  });

  return app;
}
