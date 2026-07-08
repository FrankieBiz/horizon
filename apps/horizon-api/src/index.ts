import { buildApp } from "./app.js";
import { getPool } from "./db/pool.js";
import { env } from "./env.js";
import { supabaseVerifier } from "./middleware/auth.js";
import { supabaseAuthDeleter } from "./services/accountService.js";
import { makeWeeklyRunnerWithDeps } from "./coach/run.js";
import { makeAnthropicGenerator } from "./coach/anthropic.js";
import { makeNotifier } from "./services/pushService.js";

const e = env();

const app = buildApp({
  db: getPool(),
  verifyToken: supabaseVerifier(e.SUPABASE_JWT_SECRET),
  deleteAuthUser: supabaseAuthDeleter(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY),
  cronSecret: e.CRON_SECRET,
  runWeekly: makeWeeklyRunnerWithDeps({
    db: getPool(),
    generate: makeAnthropicGenerator(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL),
    notify: makeNotifier(getPool(), e),
  }),
});

app.listen(e.PORT, () => {
  console.log(`[horizon-api] listening on :${e.PORT} (${e.NODE_ENV})`);
});
