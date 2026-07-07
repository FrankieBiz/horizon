import pg from "pg";
import { env } from "../env.js";

/** Anything with pg's query signature — the Pool in prod, a fake in tests. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: env().DATABASE_URL, max: 5 });
  }
  return pool;
}

/** Run `fn` inside a transaction on a dedicated client. */
export async function withTransaction<T>(
  run: (client: Queryable) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
