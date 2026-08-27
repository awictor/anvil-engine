import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  // DEV-0120: a Blocked protocol/URL throw (e.g. actions.navigateInContext, reached via
  // /v1/contexts/:id which has no inline pre-guard) is a client 400, not a 500.
  it("maps a Blocked protocol/URL throw -> 400 (not 500)", () => {
    expect(errorToResponse(new Error("Blocked protocol: only http/https allowed")).status).toBe(400);
    expect(errorToResponse(new Error("Blocked URL: private IP")).status).toBe(400);
    // message passthrough preserved for these (not the JSON placeholder)
    expect(errorToResponse(new Error("Blocked protocol: only http/https allowed")).body.error).toMatch(/Blocked protocol/);
  });

  // DEV-0145: a Playwright/CDP timeout is an upstream-browser gateway timeout (504), not an anvil
  // fault (500), so a caller (relay/DataFaucet) doesn't read an expected page timeout as an outage.
  it("maps a Playwright timeout -> 504 (not 500)", () => {
    // by message shape ("Timeout 30000ms exceeded")
    expect(errorToResponse(new Error("Timeout 30000ms exceeded")).status).toBe(504);
    expect(errorToResponse(new Error("page.waitForSelector: Timeout 5000 ms exceeded")).status).toBe(504);
    // by error name (Playwright throws TimeoutError)
    const te = new Error("waiting for selector failed");
    te.name = "TimeoutError";
    expect(errorToResponse(te).status).toBe(504);
    // message passthrough preserved
    expect(errorToResponse(new Error("Timeout 30000ms exceeded")).body.error).toMatch(/Timeout/);
    // a generic error is still 500 (timeout branch didn't widen)
    expect(errorToResponse(new Error("boom")).status).toBe(500);
  });

  // DEV-0146: a CDP/browser-crash disconnect is an upstream failure (502), not an anvil bug (500),
  // reusing browser-helper's CRASH_PATTERNS via isCrashError.
  it("maps a browser-crash disconnect -> 502 (not 500)", () => {
    for (const msg of ["Target closed", "Session closed", "Protocol error (Runtime.evaluate): Target closed", "browser has disconnected"]) {
      expect(errorToResponse(new Error(msg)).status, msg).toBe(502);
    }
    // message passthrough preserved
    expect(errorToResponse(new Error("Target closed")).body.error).toMatch(/Target closed/);
    // still-500 generic and still-504 timeout unaffected by the new branch
    expect(errorToResponse(new Error("boom")).status).toBe(500);
    expect(errorToResponse(new Error("Timeout 30000ms exceeded")).status).toBe(504);
  });

  // DEV-0152: a per-session tab-cap is a client back-off (429), not a server fault (500).
  it("maps a page-limit throw -> 429 (not 500)", () => {
    expect(errorToResponse(new Error("Page limit reached: this session already has 8/8 pages open")).status).toBe(429);
    expect(errorToResponse(new Error("Page limit reached: this session already has 8/8 pages open")).body.error).toMatch(/limit reached/);
    // other classes unaffected
    expect(errorToResponse(new Error("boom")).status).toBe(500);
    expect(errorToResponse(new Error("Target closed")).status).toBe(502);
    expect(errorToResponse(new Error("Session not found")).status).toBe(404);
  });

  // DEV-0153: complete the actions.ts throw taxonomy.
  it("maps out-of-range->400, last-remaining->409, script-timeout->504", () => {
    expect(errorToResponse(new Error("Page index 9 out of range")).status).toBe(400);
    expect(errorToResponse(new Error("Cannot close the last remaining page")).status).toBe(409);
    expect(errorToResponse(new Error("Script execution timed out after 5000ms")).status).toBe(504);
    // the widened timeout branch still catches the Playwright phrasing
    expect(errorToResponse(new Error("Timeout 30000ms exceeded")).status).toBe(504);
    // and doesn't swallow the existing classes
    expect(errorToResponse(new Error("boom")).status).toBe(500);
    expect(errorToResponse(new Error("Session not found")).status).toBe(404);
    expect(errorToResponse(new Error("Page limit reached: 8/8")).status).toBe(429);
  });

  // DEV-0154 (HARDEN): the taxonomy tests above use HAND-WRITTEN strings; if someone reworded a real
  // actions.ts throw, the classifier could silently revert to 500 while these stayed green. Pin the
  // ACTUAL throw literals from src/actions.ts to their intended status so a message edit that breaks
  // the mapping fails CI. Read the source (no browser needed) and assert the concrete phrases.
  it("real actions.ts throw messages still classify as intended (regression guard)", () => {
    const src = readFileSync(join(process.cwd(), "src", "actions.ts"), "utf8");
    // [substring that must appear in a throw, expected status, why]
    const cases: Array<[string, number]> = [
      ["Browser connection failed", 502],  // crash disconnect
      ["Session not found", 404],
      ["Blocked protocol: only http/https allowed", 400],
      ["Page limit reached", 429],
      ["out of range", 400],
      ["Cannot close the last remaining page", 409],
      ["not found", 404],                  // "Context <id> not found" / "Element not found"
      ["timed out after", 504],            // "Script execution timed out after <n>ms"
    ];
    for (const [phrase, status] of cases) {
      expect(src.includes(phrase), `actions.ts no longer throws a message containing "${phrase}"`).toBe(true);
      // Build a representative real message per phrase: "Blocked ..." is ^-anchored in the classifier
      // and "timed out after" needs a trailing "<n>ms" — both must not be prefix-wrapped.
      const msg = phrase === "timed out after" ? "Script execution timed out after 5000ms"
        : phrase.startsWith("Blocked") ? phrase
        : `prefix ${phrase} suffix`;
      expect(errorToResponse(new Error(msg)).status, phrase).toBe(status);
    }
  });

  // DEV-0181: a bad proxy on session create (unsupported scheme / private-host SSRF reject) throws from
  // launcher.validateProxyUrl and bubbles to the app.ts central catch → errorToResponse. Both are CLIENT
  // faults (400), not a blanket 500 that mis-signals an anvil outage + pollutes serverErrorsCount. Map
  // both, and pin the REAL launcher.ts throw literals so a reworded message can't silently revert to 500.
  it("maps a bad-proxy throw -> 400 (unsupported scheme + private-host SSRF)", () => {
    // representative real messages
    expect(errorToResponse(new Error("Unsupported proxy scheme: ftp: (allowed: http, https, socks, socks4, socks5)")).status).toBe(400);
    expect(errorToResponse(new Error('Proxy host "10.0.0.1" is private or internal and not allowed. Set ANVIL_ALLOW_PRIVATE_PROXY=true to override.')).status).toBe(400);
    // message passthrough preserved (not the JSON-specific body)
    expect(errorToResponse(new Error("Unsupported proxy scheme: ftp:")).body.error).toMatch(/Unsupported proxy scheme/);
    // other classes unaffected
    expect(errorToResponse(new Error("boom")).status).toBe(500);
    expect(errorToResponse(new Error("Target closed")).status).toBe(502);
    expect(errorToResponse(new Error("Session not found")).status).toBe(404);
    // regression guard: the ACTUAL launcher.ts throw literals still classify as intended
    const src = readFileSync(join(process.cwd(), "src", "launcher.ts"), "utf8");
    expect(src.includes("Unsupported proxy scheme"), "launcher.ts no longer throws 'Unsupported proxy scheme'").toBe(true);
    expect(src.includes("is private or internal and not allowed"), "launcher.ts no longer throws the private-host reject").toBe(true);
  });
});
