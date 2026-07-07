import { buildApp } from "./app.js";
import { getPool } from "./db/pool.js";
import { env } from "./env.js";
import { supabaseVerifier } from "./middleware/auth.js";
import { supabaseAuthDeleter } from "./services/accountService.js";
import { makeWeeklyRunner } from "./coach/run.js";

const e = env();

const app = buildApp({
  db: getPool(),
  verifyToken: supabaseVerifier(e.SUPABASE_JWT_SECRET),
  deleteAuthUser: supabaseAuthDeleter(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY),
  cronSecret: e.CRON_SECRET,
  runWeekly: makeWeeklyRunner(getPool()),
});

app.listen(e.PORT, () => {
  console.log(`[horizon-api] listening on :${e.PORT} (${e.NODE_ENV})`);
});
