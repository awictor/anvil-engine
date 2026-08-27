import type { IncomingMessage, ServerResponse } from "node:http";
import { type RateLimiter } from "./rate-limiter.js";
import { json } from "./http-utils.js";
import { isCrashError } from "./browser-helper.js";

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
  // A Blocked protocol/URL is an SSRF-style client rejection (400), not a server error. Most routes
  // pre-guard inline and return 400, but the contexts navigate path lets actions.* throw it — map it
  // here so it's a 400 everywhere (DEV-0120).
  const isBlocked = /^Blocked (protocol|URL)/i.test(message);
  // A Playwright/CDP timeout (navigation or selector wait) means the UPSTREAM browser didn't reach the
  // expected state in time — that's a gateway timeout (504), not an anvil server fault (500). Callers
  // that treat anvil as a dependency (relay, DataFaucet) otherwise read an expected page timeout as an
  // anvil OUTAGE and mis-alert / aggressively retry (DEV-0145; extends the DEV-0119/0120 taxonomy).
  const isTimeout = (err instanceof Error && err.name === "TimeoutError")
    || /Timeout\s+\d+\s*ms\s+exceeded|TimeoutError|timed out after \d+\s*ms/i.test(message);
  // A CDP/browser-crash disconnect (Target closed / Session closed / Protocol error / browser has
  // disconnected — the exact set in browser-helper's CRASH_PATTERNS, reused via isCrashError) is an
  // UPSTREAM failure (502 Bad Gateway), not an anvil bug (500), so a caller can tell a browser crash
  // apart from a server fault (DEV-0146; extends the DEV-0119/0120/0145 taxonomy). Ordered AFTER the
  // client-4xx and timeout branches so those still win.
  const isCrash = isCrashError(err);
  // A per-session resource cap ("Page limit reached: N/CAP") is a CLIENT back-off condition (429 Too
  // Many Requests), not a server fault (500) — a caller can retry after closing a tab. Keeps it out of
  // serverErrorsCount (5xx-only, DEV-0147) so a client hammering the cap can't fake an outage (DEV-0152).
  const isLimit = /limit reached/i.test(message);
  // More client/state faults that must not read as anvil bugs (DEV-0153): an out-of-range page index
  // is invalid client input (400); refusing to close the last remaining page is a state conflict (409).
  const isBadInput = /out of range/i.test(message);
  const isConflict = /Cannot close the last remaining/i.test(message);
  // A bad proxy on session create is a CLIENT fault, not an anvil bug (DEV-0181): an unsupported proxy
  // scheme is invalid input, and a private/internal proxy host is an SSRF-style rejection — both throw
  // from launcher.validateProxyUrl and otherwise bubble to a blanket 500 (mis-signalling an outage +
  // polluting serverErrorsCount). Map both to 400, in the client-4xx group.
  const isBadProxy = /^Unsupported proxy scheme/i.test(message)
    || /is private or internal and not allowed/i.test(message);
  const status = isBadJson ? 400
    : isBlocked ? 400
    : isBadInput ? 400
    : isBadProxy ? 400
    : isTimeout ? 504
    : isCrash ? 502
    : isLimit ? 429
    : isConflict ? 409
    : message.includes("too large") ? 413
    : message.includes("not found") || message.includes("Not found") ? 404
    : 500;
  const body = isBadJson ? { error: "Invalid JSON in request body" } : { error: message };
  return { status, body };
}
