import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { healthRoutes } from "../src/routes/health.js";
import { counters, recordRequest, resetForTests } from "../src/metrics.js";

// DEV-0049: healthRoutes has real branch logic that no UNIT test exercised — /v1/ready flips
// 200<->503 on pool/session state, and /v1/docs hardcodes `endpoints: 38` next to a catalog that
// is the real source of truth, so a drifted count would ship silently (the integration test only
// re-asserts the same hardcoded 38, it never checks it against the catalog). Drives the actual
// handlers with the DEV-0048 mock-res harness.

// Minimal ServerResponse stand-in: records writeHead status/headers + collects the JSON body.
function mkRes() {
  let statusCode = 0;
  let headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  (res as any).headersSent = false;
  (res as any).writeHead = (code: number, h?: Record<string, string>) => {
    statusCode = code;
    if (h) headers = h;
    (res as any).headersSent = true;
    return res;
  };
  return {
    res: res as any,
    get status() { return statusCode; },
    get headers() { return headers; },
    get json() { return JSON.parse(Buffer.concat(chunks).toString()); },
  };
}

// deps: sessionManager.size + lifecycleStats, pool.available, config.sessionTimeoutMs are read.
function fakeDeps(opts: { size?: number; pool?: { available: number } | null }) {
  return {
    sessionManager: {
      size: opts.size ?? 0,
      lifecycleStats: () => ({ inFlightTotal: 0, oldestAgeMs: 0, oldestIdleMs: 0 }),
    },
    pool: opts.pool === undefined ? null : opts.pool,
    config: { sessionTimeoutMs: 300000, maxSessions: 10, poolSize: 2 },
  } as any;
}

function route(deps: any, pattern: string) {
  return healthRoutes(deps).find((r: any) => r.pattern === pattern)!;
}

const ctx = (r: any) => ({ req: {} as any, res: r.res, url: new URL("http://x/"), params: {}, requestId: "t" });

describe("healthRoutes handlers (DEV-0049)", () => {
  it("GET /v1/ready -> 200 ready when no pool is configured", () => {
    const r = mkRes();
    route(fakeDeps({ pool: null }), "/v1/ready").handler(ctx(r));
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("ready");
    expect(r.json.poolAvailable).toBeNull();
  });

  it("GET /v1/ready -> 200 ready when pool has capacity", () => {
    const r = mkRes();
    route(fakeDeps({ pool: { available: 2 } }), "/v1/ready").handler(ctx(r));
    expect(r.status).toBe(200);
    expect(r.json.poolAvailable).toBe(2);
  });

  it("GET /v1/ready -> 200 ready when pool empty but a session is live", () => {
    const r = mkRes();
    route(fakeDeps({ pool: { available: 0 }, size: 1 }), "/v1/ready").handler(ctx(r));
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("ready");
  });

  it("GET /v1/ready -> 503 not_ready when pool empty AND no sessions", () => {
    const r = mkRes();
    route(fakeDeps({ pool: { available: 0 }, size: 0 }), "/v1/ready").handler(ctx(r));
    expect(r.status).toBe(503);
    expect(r.json.status).toBe("not_ready");
    expect(r.json.poolAvailable).toBe(0);
  });

  it("GET /v1/health -> 200 with session count + configured timeout", () => {
    const r = mkRes();
    route(fakeDeps({ size: 3 }), "/v1/health").handler(ctx(r));
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("ok");
    expect(r.json.sessions).toBe(3);
    expect(r.json.sessionTimeoutMs).toBe(300000);
    expect(r.json.multiSession).toBe(true);
    // capacity fields (m17 anvil-ops-2)
    expect(r.json.maxSessions).toBe(10);
    expect(r.json.poolSize).toBe(2);
    expect(r.json.poolAvailable).toBe(0); // no pool in this fake -> 0, not undefined/crash
  });

  it("GET /v1/health -> poolAvailable reflects a configured pool", () => {
    const r = mkRes();
    route(fakeDeps({ size: 1, pool: { available: 2 } }), "/v1/health").handler(ctx(r));
    expect(r.json.poolAvailable).toBe(2);
    expect(r.json.maxSessions).toBe(10);
  });

  it("GET /v1/live -> 200 alive", () => {
    const r = mkRes();
    route(fakeDeps({}), "/v1/live").handler(ctx(r));
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("alive");
  });

  it("GET /v1/docs declared `endpoints` equals the summed catalog (drift guard)", () => {
    const r = mkRes();
    route(fakeDeps({}), "/v1/docs").handler(ctx(r));
    expect(r.status).toBe(200);
    const cats = r.json.categories as Record<string, unknown[]>;
    const summed = Object.values(cats).reduce((n, arr) => n + arr.length, 0);
    // If someone adds/removes a catalog entry without touching the hardcoded count, this fails.
    expect(r.json.endpoints).toBe(summed);
  });
});

describe("GET /v1/metrics handler (DEV-0050)", () => {
  it("returns 200 merging legacy counters + live activeSessions + an endpoints snapshot", () => {
    resetForTests();
    // Drive a real request through the recorder so the snapshot + counters are non-trivial.
    recordRequest("GET", "/v1/health", 200, 5);
    recordRequest("POST", "/v1/scrape", 500, 12);
    const r = mkRes();
    route(fakeDeps({ size: 4 }), "/v1/metrics").handler(ctx(r));
    expect(r.status).toBe(200);
    // activeSessions reflects sessionManager.size (NOT the counters snapshot).
    expect(r.json.activeSessions).toBe(4);
    // legacy counter keys are spread onto the body verbatim.
    expect(r.json.requestsServed).toBe(counters.requestsServed);
    expect(r.json.errorsCount).toBe(counters.errorsCount);
    expect(r.json.errorsCount).toBeGreaterThanOrEqual(1); // the 500 above
    expect(typeof r.json.uptime).toBe("number");
    // capacity fields (m17 anvil-ops-2): ceiling + pool depth for exhaustion monitoring.
    expect(r.json.maxSessions).toBe(10);
    expect(r.json.poolSize).toBe(2);
    expect(r.json.poolAvailable).toBe(0);
    // endpoints is the per-route snapshot object, keyed by normalized route.
    expect(r.json.endpoints).toBeTypeOf("object");
    expect(r.json.endpoints).not.toBeNull();
    expect(Object.keys(r.json.endpoints).length).toBeGreaterThan(0);
    resetForTests();
  });
});
