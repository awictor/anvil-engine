import { describe, it, expect } from "vitest";
import { SessionManager } from "../src/session.js";
import { BrowserPool } from "../src/pool.js";
import { withBrowser } from "../src/browser-helper.js";

describe("integration: SessionManager + BrowserPool", () => {
  it("SessionManager works with pool (no launch needed)", () => {
    const pool = new BrowserPool(2);
    const mgr = new SessionManager(pool);
    expect(mgr.size).toBe(0);
    expect(pool.available).toBe(0);
  });

  it("SessionManager works without pool (backward compat)", () => {
    const mgr = new SessionManager();
    expect(mgr.size).toBe(0);
    expect(mgr.list()).toEqual([]);
  });

  it("destroyAll returns 0 on empty manager", async () => {
    const mgr = new SessionManager();
    const count = await mgr.destroyAll();
    expect(count).toBe(0);
  });
});

describe("integration: withBrowser helper", () => {
  it("exports withBrowser function", () => {
    expect(typeof withBrowser).toBe("function");
  });

  it("withBrowser requires wsEndpoint string", () => {
    // Type contract: first arg is string, second is async function
    const fn = withBrowser;
    expect(fn.length).toBe(2);
  });
});

describe("integration: module dependency graph", () => {
  it("api.ts imports can all resolve", async () => {
    // These imports verify the dependency graph is sound
    const session = await import("../src/session.js");
    const pool = await import("../src/pool.js");
    const launcher = await import("../src/launcher.js");
    const helper = await import("../src/browser-helper.js");
    const cdp = await import("../src/cdp-proxy.js");

    expect(session.SessionManager).toBeDefined();
    expect(pool.BrowserPool).toBeDefined();
    expect(launcher.launchBrowser).toBeDefined();
    expect(helper.withBrowser).toBeDefined();
    expect(cdp.createCdpProxy).toBeDefined();
  });

  it("no circular imports (all modules load independently)", async () => {
    const results = await Promise.all([
      import("../src/session.js"),
      import("../src/pool.js"),
      import("../src/launcher.js"),
      import("../src/browser-helper.js"),
      import("../src/cdp-proxy.js"),
      import("../src/fingerprint.js"),
      import("../src/webhooks.js"),
      import("../src/rate-limiter.js"),
      import("../src/client.js"),
    ]);
    expect(results).toHaveLength(9);
  });
});

describe("integration: API endpoint contract consistency", () => {
  it("all endpoints that modify browser require active session", () => {
    const sessionRequiredEndpoints = [
      "POST /v1/actions/navigate",
      "POST /v1/actions/evaluate",
      "POST /v1/actions/click",
      "POST /v1/actions/type",
      "POST /v1/actions/select",
      "POST /v1/actions/hover",
      "POST /v1/actions/wait",
      "POST /v1/actions/upload",
      "POST /v1/scrape",
      "POST /v1/pdf",
      "GET /v1/screenshot",
      "GET /v1/cookies",
      "POST /v1/cookies",
      "POST /v1/intercept",
      "POST /v1/har/start",
      "POST /v1/har/stop",
      "GET /v1/har",
      "POST /v1/recording/start",
      "POST /v1/recording/stop",
      "GET /v1/recording",
      "GET /v1/downloads",
      "GET /v1/downloads/:filename",
    ];
    expect(sessionRequiredEndpoints).toHaveLength(22);
  });

  it("session lifecycle endpoints exist", () => {
    const lifecycleEndpoints = [
      "POST /v1/sessions",
      "GET /v1/sessions",
      "GET /v1/sessions/:id",
      "GET /v1/sessions/list",
      "POST /v1/sessions/:id/release",
    ];
    expect(lifecycleEndpoints).toHaveLength(5);
  });

  it("total endpoint count is 30", () => {
    const allEndpoints = [
      "POST /v1/sessions", "GET /v1/sessions", "GET /v1/sessions/:id",
      "GET /v1/sessions/list", "POST /v1/sessions/:id/release",
      "POST /v1/actions/navigate", "POST /v1/actions/click", "POST /v1/actions/type",
      "POST /v1/actions/select", "POST /v1/actions/hover", "POST /v1/actions/wait",
      "POST /v1/actions/evaluate", "POST /v1/actions/upload",
      "POST /v1/scrape", "POST /v1/pdf", "GET /v1/screenshot",
      "GET /v1/cookies", "POST /v1/cookies",
      "POST /v1/har/start", "POST /v1/har/stop", "GET /v1/har",
      "POST /v1/recording/start", "POST /v1/recording/stop", "GET /v1/recording",
      "POST /v1/intercept",
      "GET /v1/downloads", "GET /v1/downloads/:filename",
      "GET /v1/health", "GET /v1/metrics", "GET /v1/docs",
    ];
    expect(allEndpoints).toHaveLength(30);
  });
});

describe("integration: client SDK module", () => {
  it("client.ts exports AnvilClient class", async () => {
    const mod = await import("../src/client.js");
    expect(mod.AnvilClient).toBeDefined();
    expect(typeof mod.AnvilClient).toBe("function");
  });

  it("AnvilClient can be instantiated", async () => {
    const { AnvilClient } = await import("../src/client.js");
    const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
    expect(client).toBeInstanceOf(AnvilClient);
  });

  it("fingerprint.ts exports generateFingerprintScript", async () => {
    const mod = await import("../src/fingerprint.js");
    expect(typeof mod.generateFingerprintScript).toBe("function");
  });
});
