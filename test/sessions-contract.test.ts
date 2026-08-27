import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import { sessionRoutes } from "../src/routes/sessions.js";
import type { Deps } from "../src/routes/deps.js";

// DEV-0170: POST /v1/sessions is the highest-traffic consumer contract — relay (src/anvil.ts requires
// parsed.id) + mcp-forge (via the vendored anvil-client) both parse this 201 body, yet it had no
// contract test while contexts/pages/network/view do. Pin (a) the routing shape and (b) the 201
// response key-set so a field rename/removal can't silently break BOTH products. Handler is invoked
// with fake deps (no real browser) — a minimal sessionManager/actions/config stub.

const stub = () => {
  const fakeSession = {
    id: "sess-abc123",
    status: "live",
    browserProcess: { cdpPort: 9222, downloadDir: "" },
    options: { userAgent: undefined },
    createdAt: 1_700_000_000_000,
  };
  const deps = {
    sessionManager: {
      size: 0,
      create: async () => fakeSession,
    },
    actions: { applySessionDefaults: async () => {} },
    config: { port: 3000, maxSessions: 10 },
  } as unknown as Deps;
  return { deps, fakeSession };
};

function fakeCtx() {
  const captured: { status?: number; body?: any } = {};
  const res = {
    statusCode: 200,
    setHeader() {},
    end(payload?: string) { captured.body = payload ? JSON.parse(payload) : undefined; captured.status = this.statusCode; },
    writeHead(code: number) { this.statusCode = code; return this; },
  } as any;
  // http-utils json() sets res.statusCode then res.end(JSON.stringify(body)); capture both.
  // readBody registers data/end/error listeners and resolves on "end" — fire "end" (empty body) so
  // the POST handler proceeds; other events are no-ops.
  const req = { headers: {}, on(ev: string, cb: (arg?: unknown) => void) { if (ev === "end") cb(); return this; } } as any;
  return { req, res, url: new URL("http://x/v1/sessions"), params: {}, requestId: "t", captured };
}

describe("/v1/sessions contract (DEV-0170)", () => {
  const routes = sessionRoutes(stub().deps);
  const r = new Router();
  r.addAll(routes);

  it("POST + GET /v1/sessions match (create + active-info)", () => {
    expect(r.match("POST", "/v1/sessions")).not.toBeNull();
    expect(r.match("GET", "/v1/sessions")).not.toBeNull();
  });

  it("POST /v1/sessions 201 body includes the consumer-parsed key-set", async () => {
    const { deps } = stub();
    const route = sessionRoutes(deps).find((rt) => rt.method === "POST" && rt.pattern === "/v1/sessions")!;
    const ctx = fakeCtx();
    await route.handler(ctx as any);
    expect(ctx.captured.status).toBe(201);
    const b = ctx.captured.body;
    // relay anvil.ts requires a non-empty string id; mcp-forge parses the same shape.
    expect(typeof b.id).toBe("string");
    expect(b.id.length).toBeGreaterThan(0);
    expect(b).toHaveProperty("status");
    expect(b).toHaveProperty("websocketUrl");
    expect(b).toHaveProperty("cdpPort");
    expect(b).toHaveProperty("createdAt");
  });
});
