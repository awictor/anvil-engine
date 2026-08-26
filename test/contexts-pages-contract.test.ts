import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import { contextRoutes } from "../src/routes/contexts.js";
import { pageRoutes } from "../src/routes/pages.js";
import type { Deps } from "../src/routes/deps.js";

// DEV-0020: contexts.ts (isolated browser sessions) + pages.ts (multi-tab) were the last two /v1
// route groups without a contract test (view/network/recording/downloads have one). Both are part
// of the stable /v1 surface relay + DataFaucet depend on. Pin the method + param-route shape so a
// refactor can't flip a verb or drop the :id/:index capture. Routing-shape only — stub deps.

const stubDeps = {} as unknown as Deps;

function router(routes: ReturnType<typeof contextRoutes>): Router {
  const r = new Router();
  r.addAll(routes);
  return r;
}

describe("/v1/contexts contract (DEV-0020)", () => {
  const r = router(contextRoutes(stubDeps));

  it("GET + POST /v1/contexts match (list + create)", () => {
    expect(r.match("GET", "/v1/contexts")).not.toBeNull();
    expect(r.match("POST", "/v1/contexts")).not.toBeNull();
  });

  it("DELETE /v1/contexts/:id matches with the id captured", () => {
    const m = r.match("DELETE", "/v1/contexts/ctx-abc123");
    expect(m).not.toBeNull();
    expect(m!.params.id).toBe("ctx-abc123");
  });

  it("DELETE /v1/contexts (no id) does NOT match — the collection isn't deletable", () => {
    expect(r.match("DELETE", "/v1/contexts")).toBeNull();
  });

  it("PUT /v1/contexts does NOT match — no update verb", () => {
    expect(r.match("PUT", "/v1/contexts")).toBeNull();
  });

  it("exposes exactly the expected method+pattern pairs", () => {
    const pairs = contextRoutes(stubDeps).map((rt) => `${rt.method} ${rt.pattern}`).sort();
    expect(pairs).toEqual(["GET /v1/contexts", "POST /v1/contexts", "DELETE /v1/contexts/:id"].sort());
  });
});

describe("/v1/pages contract (DEV-0020)", () => {
  const r = router(pageRoutes(stubDeps));

  it("GET + POST /v1/pages match (list tabs + open tab)", () => {
    expect(r.match("GET", "/v1/pages")).not.toBeNull();
    expect(r.match("POST", "/v1/pages")).not.toBeNull();
  });

  it("DELETE /v1/pages/:index matches with the index captured", () => {
    const m = r.match("DELETE", "/v1/pages/2");
    expect(m).not.toBeNull();
    expect(m!.params.index).toBe("2");
  });

  it("DELETE /v1/pages (no index) does NOT match — must target a specific tab", () => {
    expect(r.match("DELETE", "/v1/pages")).toBeNull();
  });

  it("PUT /v1/pages does NOT match — no update verb", () => {
    expect(r.match("PUT", "/v1/pages")).toBeNull();
  });

  it("exposes exactly the expected method+pattern pairs", () => {
    const pairs = pageRoutes(stubDeps).map((rt) => `${rt.method} ${rt.pattern}`).sort();
    expect(pairs).toEqual(["GET /v1/pages", "POST /v1/pages", "DELETE /v1/pages/:index"].sort());
  });
});
