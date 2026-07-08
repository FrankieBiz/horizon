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

// $/M tokens; used for coach_runs.cost_usd bookkeeping.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

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

    const text = (response.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const summary = weeklySummarySchema.parse(JSON.parse(text));

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
