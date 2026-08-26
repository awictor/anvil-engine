import { describe, it, expect } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { corsMiddleware, rateLimitMiddleware, authMiddleware, errorToResponse, EXEMPT_PATHS } from "../src/middleware.js";
import type { RateLimiter } from "../src/rate-limiter.js";

// DEV-0029: middleware is the per-request security chain (CORS -> OPTIONS -> rate limit -> auth).
// Untested. Pin the gates: auth 401 on bad Bearer + exempt-path/no-key passthrough, rate-limit 429
// + exempt/null passthrough, CORS 204 on OPTIONS. Fake req/res/url; no real server.

// Minimal ServerResponse stub capturing what middleware does to it.
function fakeRes() {
  const rec = { status: 0, headers: {} as Record<string, string>, ended: false, body: "" };
  const res = {
    headersSent: false,
    setHeader: (k: string, v: string) => { rec.headers[k.toLowerCase()] = String(v); },
    writeHead: (s: number, h?: Record<string, string>) => { rec.status = s; if (h) for (const [k, v] of Object.entries(h)) rec.headers[k.toLowerCase()] = String(v); return res; },
    end: (b?: string) => { rec.ended = true; if (b) rec.body = b; },
  } as unknown as ServerResponse;
  return { res, rec };
}
const req = (headers: Record<string, string> = {}, method = "GET") =>
  ({ headers, method, socket: { remoteAddress: "1.2.3.4" } } as unknown as IncomingMessage);
const url = (p = "/v1/scrape") => new URL(`http://x${p}`);

describe("authMiddleware (DEV-0029)", () => {
  it("passes through when no apiKey is configured", () => {
    const { res } = fakeRes();
    expect(authMiddleware("")(req(), res, url())).toBe(true);
  });
  it("401s a missing/wrong Bearer when a key is set", () => {
    const { res, rec } = fakeRes();
    expect(authMiddleware("secret")(req({}), res, url())).toBe(false);
    expect(rec.status).toBe(401);
  });
  it("passes a correct Bearer", () => {
    const { res } = fakeRes();
    expect(authMiddleware("secret")(req({ authorization: "Bearer secret" }), res, url())).toBe(true);
  });
  it("exempts operational paths even with a wrong key", () => {
    const { res } = fakeRes();
    expect(authMiddleware("secret")(req({}), res, url("/v1/health"))).toBe(true);
    expect(EXEMPT_PATHS.has("/v1/health")).toBe(true);
  });
});

describe("rateLimitMiddleware (DEV-0029)", () => {
  const limiter = (allowed: boolean): RateLimiter =>
    ({ consume: () => ({ allowed, retryAfterSec: 5 }) } as unknown as RateLimiter);

  it("passes when no limiter is configured (null)", () => {
    const { res } = fakeRes();
    expect(rateLimitMiddleware(null)(req(), res, url())).toBe(true);
  });
  it("429s a blocked IP and sets Retry-After", () => {
    const { res, rec } = fakeRes();
    expect(rateLimitMiddleware(limiter(false))(req(), res, url())).toBe(false);
    expect(rec.status).toBe(429);
    expect(rec.headers["retry-after"]).toBe("5");
  });
  it("passes an allowed IP", () => {
    const { res } = fakeRes();
    expect(rateLimitMiddleware(limiter(true))(req(), res, url())).toBe(true);
  });
  it("exempts operational paths even when the limiter would block", () => {
    const { res } = fakeRes();
    expect(rateLimitMiddleware(limiter(false))(req(), res, url("/v1/metrics"))).toBe(true);
  });
});

describe("corsMiddleware (DEV-0029)", () => {
  it("204s an OPTIONS preflight and stops the chain", () => {
    const { res, rec } = fakeRes();
    expect(corsMiddleware()(req({}, "OPTIONS"), res, url())).toBe(false);
    expect(rec.status).toBe(204);
    expect(rec.headers["access-control-allow-origin"]).toBe("*");
  });
  it("sets CORS headers and continues for a normal request", () => {
    const { res, rec } = fakeRes();
    expect(corsMiddleware()(req({}, "GET"), res, url())).toBe(true);
    expect(rec.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("errorToResponse (DEV-0030 — mapping)", () => {
  it("maps too-large -> 413, not-found -> 404, else 500, message passthrough", () => {
    expect(errorToResponse(new Error("Request body too large"))).toEqual({ status: 413, body: { error: "Request body too large" } });
    expect(errorToResponse(new Error("Session not found")).status).toBe(404);
    expect(errorToResponse(new Error("Not found")).status).toBe(404);
    const e = errorToResponse(new Error("boom"));
    expect(e.status).toBe(500);
    expect(e.body.error).toBe("boom");
  });

  // DEV-0119: a malformed JSON body throws SyntaxError from JSON.parse in the handlers — that's a
  // client 400, not a server 500. A real JSON.parse failure is a SyntaxError; also match the message.
  it("maps a JSON parse SyntaxError -> 400 (bad request, not 500)", () => {
    let thrown: unknown;
    try { JSON.parse("{bad"); } catch (e) { thrown = e; }
    const r = errorToResponse(thrown);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Invalid JSON/i);
    // message-shape fallback (in case a parser throws a plain Error, not a SyntaxError instance)
    expect(errorToResponse(new Error("Unexpected token < in JSON at position 0")).status).toBe(400);
  });
});
