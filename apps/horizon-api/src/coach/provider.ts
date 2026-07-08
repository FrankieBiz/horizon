import type { Env } from "../env.js";
import { makeAnthropicGenerator, makeDeepSeekGenerator, type SummaryGenerator } from "./anthropic.js";

/**
 * Select the coach's LLM generator from config. The orchestrator depends only
 * on the SummaryGenerator seam, so flipping LLM_PROVIDER is the entire switch —
 * no other code path knows or cares which model wrote the review.
 */
export function makeGenerator(env: Env): SummaryGenerator {
  if (env.LLM_PROVIDER === "deepseek") {
    return makeDeepSeekGenerator(env.DEEPSEEK_API_KEY!, env.DEEPSEEK_MODEL, env.DEEPSEEK_BASE_URL);
  }
  return makeAnthropicGenerator(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_MODEL);
}

/** Human-readable name of the active LLM processor (for logs / privacy surfacing). */
export function activeProviderLabel(env: Env): string {
  return env.LLM_PROVIDER === "deepseek"
    ? `DeepSeek (${env.DEEPSEEK_MODEL})`
    : `Anthropic (${env.ANTHROPIC_MODEL})`;
}
