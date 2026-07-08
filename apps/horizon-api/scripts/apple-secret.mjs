// Generates the "Sign in with Apple" OAuth client secret (an ES256 JWT) that
// Supabase's Apple provider wants in its "Secret Key (for OAuth)" field.
//
// ONLY needed if native on-device sign-in fails (the id_token grant usually
// doesn't require it). Values come from env so no secret hits argv/history:
//
//   APPLE_P8='-----BEGIN PRIVATE KEY-----\n...' \
//   APPLE_KEY_ID=ABC123DEFG \
//   APPLE_TEAM_ID=YOURTEAMID \
//   APPLE_CLIENT_ID=com.frankbisignano.Horizon \
//     node scripts/apple-secret.mjs
//
// APPLE_CLIENT_ID: your app bundle ID for native, or your Services ID if you
// created one for the web flow. APPLE_KEY_ID / .p8 come from the Sign in with
// Apple key you create at developer.apple.com. Secret is valid ~6 months (Apple's
// max) — regenerate before it expires.
import { SignJWT, importPKCS8 } from "jose";

const { APPLE_P8, APPLE_KEY_ID, APPLE_TEAM_ID, APPLE_CLIENT_ID } = process.env;
if (!APPLE_P8 || !APPLE_KEY_ID || !APPLE_TEAM_ID || !APPLE_CLIENT_ID) {
  console.error("Set APPLE_P8, APPLE_KEY_ID, APPLE_TEAM_ID, APPLE_CLIENT_ID and re-run.");
  process.exit(1);
}

const key = await importPKCS8(APPLE_P8.replace(/\\n/g, "\n"), "ES256");
const now = Math.floor(Date.now() / 1000);
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: APPLE_KEY_ID })
  .setIssuer(APPLE_TEAM_ID)
  .setIssuedAt(now)
  .setExpirationTime(now + 15777000) // ~182 days, Apple's maximum
  .setAudience("https://appleid.apple.com")
  .setSubject(APPLE_CLIENT_ID)
  .sign(key);

console.log(jwt);
