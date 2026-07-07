import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WeeklyData } from "./schemas.js";

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "skills");

let cached: { system: string; version: string } | undefined;

/**
 * Compose the system prompt from the 8 versioned skill files (sorted by their
 * numeric prefix) and derive prompt_version from its content hash — every
 * coach_run row records exactly which prompt produced it.
 *
 * Composition = one Claude call total (prep spec §6): the domain skills are
 * sections of a single system prompt, and the safety pass is a self-check
 * section of the same call's structured output. The code-level deny-list scan
 * (denylist.ts) is the independent backstop that runs after.
 */
export function composedPrompt(): { system: string; version: string } {
  if (cached) return cached;
  const files = readdirSync(skillsDir).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) throw new Error(`no skill files found in ${skillsDir}`);
  const system = files
    .map((f) => readFileSync(join(skillsDir, f), "utf8").trim())
    .join("\n\n---\n\n");
  const version = createHash("sha256").update(system).digest("hex").slice(0, 12);
  cached = { system, version };
  return cached;
}

/** The user turn: the WeeklyData JSON, nothing else. */
export function buildUserMessage(data: WeeklyData): string {
  return [
    "Here is this user's WeeklyData for the week starting",
    `${data.week_start}. Write their weekly review per your instructions.`,
    "",
    JSON.stringify(data, null, 1),
  ].join("\n");
}
