import { buildApp } from "./app.js";
import { getPool, withTransaction } from "./db/pool.js";
import { ensureWeeklyGoalsSchema } from "./db/weeklyGoalsMigration.js";
import { env } from "./env.js";
import { supabaseVerifier } from "./middleware/auth.js";
import { supabaseAuthDeleter } from "./services/accountService.js";
import { makeWeeklyRunnerWithDeps } from "./coach/run.js";
import { makeGenerator } from "./coach/provider.js";
import { makeNotifier } from "./services/pushService.js";

const e = env();

const app = buildApp({
  db: getPool(),
  verifyToken: supabaseVerifier(e.SUPABASE_JWT_SECRET),
  deleteAuthUser: supabaseAuthDeleter(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY),
  cronSecret: e.CRON_SECRET,
  withTx: withTransaction,
  runWeekly: makeWeeklyRunnerWithDeps({
    db: getPool(),
    generate: makeGenerator(e),
    notify: makeNotifier(getPool(), e),
  }),
});

ensureWeeklyGoalsSchema(withTransaction).then(() => {
  app.listen(e.PORT, () => {
    console.log(`[horizon-api] listening on :${e.PORT} (${e.NODE_ENV})`);
  });
}).catch((error: unknown) => {
  console.error("[horizon-api] startup migration failed:",
    error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
