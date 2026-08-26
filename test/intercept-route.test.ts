import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { networkRoutes } from "../src/routes/network.js";

// DEV-0084/0085: api.test.ts's /v1/intercept block only asserts body literals. This drives the real
// networkRoutes intercept handler (mock req = Readable body + mock res, fake actions spy): validation
// (non-boolean enabled -> 400), session gate, the enabled:true/false response shapes + blocking count,
// and the blockPatterns string-filter (drops numbers/empty/null) feeding both the count and setIntercept.

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

let setInterceptCalls: Array<{ enabled: boolean; patterns: string[] }>;
function deps(hasSession = true) {
  setInterceptCalls = [];
  const session = { id: "s" };
  return {
    sessionManager: { getActive: () => (hasSession ? session : undefined), get: () => (hasSession ? session : undefined) },
    actions: { setIntercept: async (_s: any, enabled: boolean, patterns: string[]) => { setInterceptCalls.push({ enabled, patterns }); } },
  } as any;
}
function route(d: any) {
  return networkRoutes(d).find((r: any) => r.pattern === "/v1/intercept" && r.method === "POST")!;
}
const ctx = (req: any, r: any) => ({ req, res: r.res, url: new URL("http://x/"), params: {}, requestId: "t" });

describe("POST /v1/intercept handler (DEV-0084)", () => {
  it("rejects a non-boolean `enabled` with 400 (no setIntercept)", async () => {
    const r = mkRes();
    await route(deps()).handler(ctx(mkReq({ enabled: "yes" }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/enabled must be a boolean/);
    expect(setInterceptCalls).toHaveLength(0);
  });

  it("returns 400 when there is no active session", async () => {
    const r = mkRes();
    await route(deps(false)).handler(ctx(mkReq({ enabled: true }), r));
    expect(r.status).toBe(400);
    expect(setInterceptCalls).toHaveLength(0);
  });

  it("enabled:true -> 200 {enabled:true, blocking:N} and calls setIntercept(session,true,patterns)", async () => {
    const r = mkRes();
    await route(deps()).handler(ctx(mkReq({ enabled: true, blockPatterns: ["a", "b", "c"] }), r));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ enabled: true, blocking: 3 });
    expect(setInterceptCalls).toEqual([{ enabled: true, patterns: ["a", "b", "c"] }]);
  });

  it("enabled:false -> 200 {enabled:false, blocking:0}", async () => {
    const r = mkRes();
    await route(deps()).handler(ctx(mkReq({ enabled: false }), r));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ enabled: false, blocking: 0 });
    expect(setInterceptCalls[0].enabled).toBe(false);
  });
});

describe("intercept blockPatterns filter (DEV-0085)", () => {
  it("keeps only non-empty strings — numbers/empty/null are dropped from count + forward", async () => {
    const r = mkRes();
    await route(deps()).handler(ctx(mkReq({ enabled: true, blockPatterns: ["ok", "", 123, null, "two"] }), r));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ enabled: true, blocking: 2 });
    expect(setInterceptCalls).toEqual([{ enabled: true, patterns: ["ok", "two"] }]);
  });

  it("a missing blockPatterns defaults to empty (blocking:0)", async () => {
    const r = mkRes();
    await route(deps()).handler(ctx(mkReq({ enabled: true }), r));
    expect(r.json).toEqual({ enabled: true, blocking: 0 });
    expect(setInterceptCalls).toEqual([{ enabled: true, patterns: [] }]);
  });
});
