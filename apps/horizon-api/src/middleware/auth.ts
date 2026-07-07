import type { NextFunction, Request, Response } from "express";
import { jwtVerify } from "jose";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

export type TokenVerifier = (token: string) => Promise<string>;

/** Verify a Supabase access token (HS256, `sub` = user id). */
export function supabaseVerifier(jwtSecret: string): TokenVerifier {
  const key = new TextEncoder().encode(jwtSecret);
  return async (token) => {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (!payload.sub) throw new Error("token has no sub");
    return payload.sub;
  };
}

export function requireAuth(verify: TokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      res.status(401).json({ error: "missing bearer token", code: "unauthenticated" });
      return;
    }
    try {
      req.userId = await verify(token);
      next();
    } catch {
      res.status(401).json({ error: "invalid token", code: "unauthenticated" });
    }
  };
}

/** Guard for internal endpoints (cron trigger): constant secret comparison. */
export function requireCronSecret(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.header("x-cron-secret") !== secret) {
      res.status(401).json({ error: "unauthorized", code: "unauthenticated" });
      return;
    }
    next();
  };
}
