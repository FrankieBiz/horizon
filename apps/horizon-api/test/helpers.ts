import { inject, type InjectOptions } from "light-my-request";
import type { Express } from "express";
import type { Queryable } from "../src/db/pool.js";

/** Socket-free request injection (the sandbox forbids listen()). */
export async function call(app: Express, opts: InjectOptions) {
  const res = await inject(app as any, opts);
  return {
    status: res.statusCode,
    body: res.payload ? JSON.parse(res.payload) : undefined,
  };
}

/** Records every query; returns scripted results in order (or a default). */
export class FakeDb implements Queryable {
  calls: Array<{ text: string; params?: unknown[] }> = [];
  private scripted: Array<{ rows: any[]; rowCount: number | null }> = [];

  script(...results: Array<{ rows?: any[]; rowCount?: number | null }>) {
    for (const r of results) {
      this.scripted.push({ rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 1) });
    }
    return this;
  }

  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    return this.scripted.shift() ?? { rows: [{ id: "00000000-0000-0000-0000-000000000001" }], rowCount: 1 };
  }
}

export const TEST_USER = "11111111-1111-1111-1111-111111111111";

/** Token verifier that accepts the literal token "good" for TEST_USER. */
export async function fakeVerify(token: string): Promise<string> {
  if (token !== "good") throw new Error("bad token");
  return TEST_USER;
}
