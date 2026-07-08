// Render Cron entry point: `pnpm job:weekly` (or node dist/jobs/weekly.js).
// Schedule: Monday ~7am ET → "0 12 * * 1" UTC. Idempotent per (user, week);
// safe to re-run. Manual trigger: POST /internal/coach/run with CRON_SECRET.

import { getPool } from "../db/pool.js";
import { env } from "../env.js";
import { makeAnthropicGenerator } from "../coach/anthropic.js";
import { makeWeeklyRunnerWithDeps } from "../coach/run.js";
import { makeNotifier } from "../services/pushService.js";

const e = env();
const runner = makeWeeklyRunnerWithDeps({
  db: getPool(),
  generate: makeAnthropicGenerator(e.ANTHROPIC_API_KEY, e.ANTHROPIC_MODEL),
  notify: makeNotifier(getPool(), e),
});

const weekOverride = process.argv[2]; // optional yyyy-MM-dd

const results = await runner(weekOverride);
for (const r of results) {
  console.log(`[weekly] ${r.userId} ${r.weekStart} ${r.status}${r.error ? ` (${r.error})` : ""}`);
}
const failed = results.filter((r) => r.status === "failed");
await getPool().end();
process.exit(failed.length > 0 ? 1 : 0);
