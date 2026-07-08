import type { Queryable } from "../db/pool.js";
import type { Env } from "../env.js";

// Stage-6 fills in the APNs HTTP/2 sender; the notifier seam exists now so the
// orchestrator's success path is final. Payloads are content-free by policy:
// no health data ever rides in a push (privacy policy §2).

export type Notifier = (userId: string, weekStart: string) => Promise<void>;

export function makeNotifier(db: Queryable, env: Env): Notifier {
  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_KEY_P8) {
    return async () => {}; // push not configured — reviews are still fetchable in-app
  }
  return async (userId, weekStart) => {
    const { sendReviewReadyPush } = await import("./apns.js");
    const res = await db.query(
      `select apns_token from profiles where user_id = $1 and apns_token is not null`,
      [userId]);
    const token = res.rows[0]?.apns_token;
    if (!token) return;
    await sendReviewReadyPush(env, token, weekStart);
  };
}
