import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { contentRoutes } from "../src/routes/content.js";

// DEV-0078/0079: content routes validate the request BEFORE touching the browser — scrape rejects a
// missing/non-string url and any file/javascript/data: protocol, pdf rejects those protocols, cookies
// POST rejects a non-array body. These 400s are unit-testable without Chrome: the handler returns at
// the guard, never reaching actions.*. Drives contentRoutes(deps) with a mock req (Readable body) +
// mock res and a spying `actions` that FAILS if any method is called on a rejected path.

// Mock req: a Readable that emits the JSON body (readBody consumes it) + a headers bag.
function mkReq(body: unknown) {
  const r = Readable.from([Buffer.from(JSON.stringify(body))]) as any;
  r.headers = {};
  return r;
}
function mkRes() {
  let statusCode = 0;
  const chunks: Buffer[] = [];
  const res: any = {
    headersSent: false,
    writeHead(code: number) { statusCode = code; res.headersSent = true; return res; },
    end(chunk?: unknown) { if (chunk) chunks.push(Buffer.from(chunk as Buffer)); res.headersSent = true; },
  };
  return { res, get status() { return statusCode; }, get json() { return JSON.parse(Buffer.concat(chunks).toString()); } };
}

// actions that throws if ANY method is invoked — proves validation short-circuits before the browser.
const explodingActions = new Proxy({}, { get() { return () => { throw new Error("actions must not be called on a rejected request"); }; } });
const deps = { sessionManager: { getActive: () => ({ id: "s" }), get: () => ({ id: "s" }) }, actions: explodingActions } as any;

function route(pattern: string, method: string) {
  return contentRoutes(deps).find((r: any) => r.pattern === pattern && r.method === method)!;
}
const ctx = (req: any, r: any) => ({ req, res: r.res, url: new URL("http://x/"), params: {}, requestId: "t" });

describe("content route validation (DEV-0078)", () => {
  it("POST /v1/scrape rejects a missing url with 400", async () => {
    const r = mkRes();
    await route("/v1/scrape", "POST").handler(ctx(mkReq({}), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/url must be a non-empty string/);
  });

  it("POST /v1/scrape rejects a non-string url with 400", async () => {
    const r = mkRes();
    await route("/v1/scrape", "POST").handler(ctx(mkReq({ url: 123 }), r));
    expect(r.status).toBe(400);
  });

  it("POST /v1/scrape rejects a file:// url (blocked protocol)", async () => {
    const r = mkRes();
    await route("/v1/scrape", "POST").handler(ctx(mkReq({ url: "file:///etc/passwd" }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/Blocked protocol/);
  });

  it("POST /v1/pdf rejects a data: url (blocked protocol)", async () => {
    const r = mkRes();
    await route("/v1/pdf", "POST").handler(ctx(mkReq({ url: "data:text/html,<h1>x" }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/Blocked protocol/);
  });

  it("POST /v1/cookies rejects a non-array body with 400", async () => {
    const r = mkRes();
    await route("/v1/cookies", "POST").handler(ctx(mkReq({ cookies: "nope" }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/must be an array/);
  });
});

describe("BLOCKED_PROTOCOL guard (DEV-0079)", () => {
  // Exercised through the scrape handler since the regex is module-private. javascript:/FILE: variants
  // must be blocked (case-insensitive); a normal https URL must pass validation (reaching actions,
  // which here throws — proving it got PAST the protocol guard).
  it("blocks javascript: and uppercase FILE: on scrape", async () => {
    for (const url of ["javascript:alert(1)", "FILE:///x", "File:///x"]) {
      const r = mkRes();
      await route("/v1/scrape", "POST").handler(ctx(mkReq({ url }), r));
      expect(r.status, url).toBe(400);
      expect(r.json.error, url).toMatch(/Blocked protocol/);
    }
  });

  it("lets an https url through validation (reaches actions.scrape, which the spy rejects)", async () => {
    const r = mkRes();
    await expect(
      route("/v1/scrape", "POST").handler(ctx(mkReq({ url: "https://example.com" }), r)),
    ).rejects.toThrow(/actions must not be called/);
    // No 400 was written — validation passed and it proceeded to the (spy) browser call.
    expect(r.status).not.toBe(400);
  });
});

describe("scrape route forwards waitUntil/timeout to actions (DEV-0133)", () => {
  // A recording `actions` that captures the params scrape() received (no browser). Proves the
  // route threads body.waitUntil/body.timeout through; gotoOpts itself is unit-tested separately.
  function recordingDeps() {
    let captured: any = null;
    const actions = { scrape: async (_session: any, params: any) => { captured = params; return { content: "", title: "", url: params.url }; } };
    const deps2 = { sessionManager: { getActive: () => ({ id: "s" }), get: () => ({ id: "s" }) }, actions } as any;
    return { deps2, get captured() { return captured; } };
  }
  function route2(deps2: any, pattern: string, method: string) {
    return contentRoutes(deps2).find((r: any) => r.pattern === pattern && r.method === method)!;
  }

  it("forwards a caller-supplied waitUntil + timeout", async () => {
    const rec = recordingDeps();
    const r = mkRes();
    await route2(rec.deps2, "/v1/scrape", "POST").handler(ctx(mkReq({ url: "https://example.com", waitUntil: "domcontentloaded", timeout: 5000 }), r));
    expect(rec.captured.waitUntil).toBe("domcontentloaded");
    expect(rec.captured.timeout).toBe(5000);
  });

  it("leaves waitUntil/timeout undefined when omitted (actions defaults apply)", async () => {
    const rec = recordingDeps();
    const r = mkRes();
    await route2(rec.deps2, "/v1/scrape", "POST").handler(ctx(mkReq({ url: "https://example.com" }), r));
    expect(rec.captured.waitUntil).toBeUndefined();
    expect(rec.captured.timeout).toBeUndefined();
  });
});
