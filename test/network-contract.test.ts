import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import { networkRoutes } from "../src/routes/network.js";
import type { Deps } from "../src/routes/deps.js";

// DEV-0017: /v1/har/{start,stop}, GET /v1/har, POST /v1/intercept are the HAR-capture surface
// DataFaucet's anvil path depends on (auto-scan: har/start -> navigate -> har/stop -> GET /v1/har).
// recording.ts had a route test; network.ts had none. Pin the method contract so a refactor can't
// silently flip a verb (e.g. make /v1/har accept POST, or har/start respond to GET) and break the
// consumer's capture flow. Routing-shape only — handlers never run, so stub deps are safe.

const stubDeps = {} as unknown as Deps;

function networkRouter(): Router {
  const r = new Router();
  r.addAll(networkRoutes(stubDeps));
  return r;
}

describe("/v1 network routes contract (DEV-0017)", () => {
  const r = networkRouter();

  it("POST /v1/har/start matches (begin capture)", () => {
    expect(r.match("POST", "/v1/har/start")).not.toBeNull();
  });

  it("POST /v1/har/stop matches (end capture)", () => {
    expect(r.match("POST", "/v1/har/stop")).not.toBeNull();
  });

  it("GET /v1/har matches (retrieve entries)", () => {
    expect(r.match("GET", "/v1/har")).not.toBeNull();
  });

  it("POST /v1/intercept matches (toggle request blocking)", () => {
    expect(r.match("POST", "/v1/intercept")).not.toBeNull();
  });

  it("GET /v1/har/start does NOT match — capture is a POST, not a read", () => {
    expect(r.match("GET", "/v1/har/start")).toBeNull();
    expect(r.match("GET", "/v1/har/stop")).toBeNull();
  });

  it("POST /v1/har does NOT match — retrieval is GET-only", () => {
    expect(r.match("POST", "/v1/har")).toBeNull();
  });

  it("GET /v1/intercept does NOT match — intercept is a POST toggle", () => {
    expect(r.match("GET", "/v1/intercept")).toBeNull();
  });

  it("exposes exactly the expected method+pattern pairs", () => {
    const pairs = networkRoutes(stubDeps)
      .map((rt) => `${rt.method} ${rt.pattern}`)
      .sort();
    expect(pairs).toEqual(
      ["POST /v1/har/start", "POST /v1/har/stop", "GET /v1/har", "POST /v1/intercept"].sort(),
    );
  });
});
