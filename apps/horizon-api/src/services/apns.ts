import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "../env.js";

// Minimal APNs HTTP/2 sender — no third-party push SDK needed.
// Payloads are content-free by policy: title + generic body + a deep link
// carrying only the week date. No health data in transit through APNs.

let cachedJwt: { token: string; issuedAt: number } | undefined;

async function providerToken(env: Env): Promise<string> {
  // Apple requires provider tokens be refreshed every 20–60 minutes.
  const now = Date.now();
  if (cachedJwt && now - cachedJwt.issuedAt < 45 * 60 * 1000) return cachedJwt.token;
  const pem = env.APNS_KEY_P8!.replace(/\\n/g, "\n");
  const key = await importPKCS8(pem, "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APNS_KEY_ID! })
    .setIssuer(env.APNS_TEAM_ID!)
    .setIssuedAt()
    .sign(key);
  cachedJwt = { token, issuedAt: now };
  return token;
}

export async function sendReviewReadyPush(env: Env, deviceToken: string, weekStart: string): Promise<void> {
  const jwt = await providerToken(env);
  const host = env.APNS_ENV === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";

  const payload = JSON.stringify({
    aps: {
      alert: { title: "Horizon", body: "Your weekly review is ready." },
      sound: "default",
    },
    deep_link: `horizon://review/${weekStart}`,
  });

  await new Promise<void>((resolve, reject) => {
    const client = http2.connect(host);
    client.on("error", reject);
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": env.APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let body = "";
    req.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      client.close();
      if (status === 200) resolve();
      else reject(new Error(`APNs ${status}: ${body || "no body"}`));
    });
    req.on("error", (e) => { client.close(); reject(e); });
    req.end(payload);
  });
}
