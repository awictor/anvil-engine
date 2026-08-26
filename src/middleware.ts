import type { IncomingMessage, ServerResponse } from "node:http";
import { type RateLimiter } from "./rate-limiter.js";
import { json } from "./http-utils.js";

/**
 * Middleware returns true to continue the chain, false when it has already
 * ended the response. Order is load-bearing and mirrors the original inline
 * checks: CORS -> OPTIONS short-circuit -> rate limit -> auth.
 */
export type Middleware = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;

/** Paths exempt from rate limiting and auth (operational endpoints). */
export const EXEMPT_PATHS = new Set(["/v1/health", "/v1/metrics", "/v1/docs", "/v1/ready", "/v1/live"]);

export function corsMiddleware(): Middleware {
  return (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return false;
    }
    return true;
  };
}

export function rateLimitMiddleware(rateLimiter: RateLimiter | null): Middleware {
  return (req, res, url) => {
    if (!rateLimiter || EXEMPT_PATHS.has(url.pathname)) return true;
    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const { allowed, retryAfterSec } = rateLimiter.consume(clientIp);
    if (!allowed) {
      res.setHeader("Retry-After", String(retryAfterSec));
      json(res, 429, { error: "Rate limit exceeded" });
      return false;
    }
    return true;
  };
}

export function authMiddleware(apiKey: string): Middleware {
  return (req, res, url) => {
    if (!apiKey || EXEMPT_PATHS.has(url.pathname)) return true;
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${apiKey}`) {
      json(res, 401, { error: "Unauthorized" });
      return false;
    }
    return true;
  };
}

/** Maps thrown errors to the response statuses the original handler used. */
export function errorToResponse(err: unknown): { status: number; body: { error: string } } {
  const message = err instanceof Error ? err.message : String(err);
  // A malformed JSON request body throws SyntaxError from JSON.parse in the route handlers — that's a
  // client bad-request (400), not a server error (500). Detect it so a bad body doesn't read as an
  // outage to the caller's retry/alerting (DEV-0119). Match the type + the parse message shape.
  const isBadJson = err instanceof SyntaxError
    || /JSON|Unexpected token|Unexpected end of (JSON|input)/i.test(message);
  const status = isBadJson ? 400
    : message.includes("too large") ? 413
    : message.includes("not found") || message.includes("Not found") ? 404
    : 500;
  const body = isBadJson ? { error: "Invalid JSON in request body" } : { error: message };
  return { status, body };
}
