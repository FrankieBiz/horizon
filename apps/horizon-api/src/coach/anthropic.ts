import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { weeklySummarySchema, type WeeklySummary } from "./schemas.js";

// Production Claude caller. The orchestrator depends on the SummaryGenerator
// interface, not this module, so tests inject fakes.

export interface GenerateResult {
  summary: WeeklySummary;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
}

export type SummaryGenerator = (
  system: string,
  userMessage: string,
) => Promise<GenerateResult>;

// $/M tokens; used for coach_runs.cost_usd bookkeeping. DeepSeek figures are
// approximate (standard-price tier) and only feed the cost estimate.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "deepseek-chat": { in: 0.27, out: 1.1 },
  "deepseek-reasoner": { in: 0.55, out: 2.19 },
};

/**
 * Extract and validate a WeeklySummary from raw model text. Anthropic's
 * structured-outputs path returns clean JSON; providers without it (DeepSeek)
 * may wrap the object in ```json fences or stray prose, so strip to the
 * outermost {...} before parsing. zod is the real contract either way.
 */
export function parseSummary(text: string): WeeklySummary {
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1]!.trim();
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first !== -1 && last > first) body = body.slice(first, last + 1);
  return weeklySummarySchema.parse(JSON.parse(body));
}

function collectText(content: unknown): string {
  return (content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

/**
 * Structured-output JSON schema: zod-to-json-schema output stripped of the
 * constraint keywords the structured-outputs API rejects (min/max lengths,
 * numeric bounds). zod still enforces the full constraints on parse — the
 * server-side schema only needs shape + required + enums.
 */
export function structuredOutputSchema(): Record<string, unknown> {
  const raw = zodToJsonSchema(weeklySummarySchema, { $refStrategy: "none" }) as Record<string, unknown>;
  const strip = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(strip); return; }
    if (node == null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const key of ["minLength", "maxLength", "minItems", "maxItems",
                       "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
                       "pattern", "format", "default"]) {
      delete obj[key];
    }
    if (obj["type"] === "object") obj["additionalProperties"] = false;
    Object.values(obj).forEach(strip);
  };
  strip(raw);
  delete raw["$schema"];
  return raw;
}

export function makeAnthropicGenerator(apiKey: string, model: string): SummaryGenerator {
  const client = new Anthropic({ apiKey });
  const schema = structuredOutputSchema();

  return async (system, userMessage) => {
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: userMessage }],
    } as any); // output_config typing lags in some SDK versions; wire format is authoritative

    const summary = parseSummary(collectText(response.content));

    const usage = (response as any).usage ?? {};
    const tokensIn = (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const tokensOut = usage.output_tokens ?? 0;
    const price = PRICING[model] ?? PRICING["claude-opus-4-8"]!;
    const costUsd =
      ((usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 +
       (usage.cache_read_input_tokens ?? 0) * 0.1) / 1e6 * price.in +
      tokensOut / 1e6 * price.out;

    return { summary, tokensIn, tokensOut, costUsd: Number(costUsd.toFixed(4)), model };
  };
}

/**
 * DeepSeek generator via its Anthropic-compatible endpoint. DeepSeek does NOT
 * support Anthropic's output_config structured outputs, adaptive thinking, or
 * prompt caching, so we omit all three and instead instruct JSON-only output
 * (schema appended to the system prompt) and validate with parseSummary. The
 * orchestrator's existing per-user try/catch turns a parse failure into a
 * recorded 'failed' run, and the weekly job is idempotent, so a retry is safe.
 *
 * ⚠️ Health data leaves to DeepSeek's servers on this path — the privacy policy
 * names the active LLM processor accordingly (see docs/privacy).
 */
export function makeDeepSeekGenerator(apiKey: string, model: string, baseURL: string): SummaryGenerator {
  const client = new Anthropic({ apiKey, baseURL });
  const jsonInstruction =
    "\n\n---\n\nOUTPUT FORMAT: Respond with ONLY a single JSON object matching this " +
    "JSON Schema. No markdown fences, no commentary before or after — the entire " +
    "response must be the JSON object.\n\n" +
    JSON.stringify(structuredOutputSchema());

  return async (system, userMessage) => {
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: system + jsonInstruction,
      messages: [{ role: "user", content: userMessage }],
    });

    const summary = parseSummary(collectText(response.content));

    const usage = (response as any).usage ?? {};
    const tokensIn = usage.input_tokens ?? 0;
    const tokensOut = usage.output_tokens ?? 0;
    const price = PRICING[model] ?? PRICING["deepseek-chat"]!;
    const costUsd = (tokensIn / 1e6) * price.in + (tokensOut / 1e6) * price.out;

    return { summary, tokensIn, tokensOut, costUsd: Number(costUsd.toFixed(4)), model };
  };
}
