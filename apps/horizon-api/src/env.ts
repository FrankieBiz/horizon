import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  // Which LLM writes the weekly coach message. anthropic (default) uses Claude;
  // deepseek routes through DeepSeek's Anthropic-compatible endpoint.
  LLM_PROVIDER: z.enum(["anthropic", "deepseek"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com/anthropic"),
  CRON_SECRET: z.string().min(16),
  LOG_LEVEL: z.string().default("info"),
  // APNs (Stage 6; optional so the API runs without push configured)
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_P8: z.string().optional(),
  APNS_BUNDLE_ID: z.string().default("com.frankbisignano.Horizon"),
  APNS_ENV: z.enum(["development", "production"]).default("development"),
}).refine(
  (e) => e.LLM_PROVIDER === "anthropic" ? !!e.ANTHROPIC_API_KEY : !!e.DEEPSEEK_API_KEY,
  { message: "the selected LLM_PROVIDER requires its API key (ANTHROPIC_API_KEY or DEEPSEEK_API_KEY)" }
);

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Lazy so tests can run without a full environment. */
export function env(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}
