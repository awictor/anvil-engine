import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import { viewRoutes } from "../src/routes/view.js";
import type { Deps } from "../src/routes/deps.js";

// DEV-0012: /v1/view is a READ-ONLY MJPEG/JPEG surface — no click injection, unlike Browserbase's
// interactive debugger. This is a consumer contract (DataFaucet's live panel is view-only under anvil).
// Pin it: the view routes are GET-only, so a POST/PUT/DELETE to /v1/view does not match a handler
// (router returns null -> 404), i.e. there is no way to POST an interaction at the view surface.
// Handlers are never invoked here (routing-shape test only), so stub deps are fine.

const stubDeps = {} as unknown as Deps;

function viewRouter(): Router {
  const r = new Router();
  r.addAll(viewRoutes(stubDeps));
  return r;
}

describe("/v1/view read-only contract (DEV-0012)", () => {
  const r = viewRouter();

  it("GET /v1/view matches (single-frame capture)", () => {
    expect(r.match("GET", "/v1/view")).not.toBeNull();
  });

  it("GET /v1/view/stream matches (MJPEG stream)", () => {
    expect(r.match("GET", "/v1/view/stream")).not.toBeNull();
  });

  it("POST /v1/view does NOT match — no interaction at the view surface", () => {
    expect(r.match("POST", "/v1/view")).toBeNull();
  });

  it("PUT and DELETE /v1/view do NOT match", () => {
    expect(r.match("PUT", "/v1/view")).toBeNull();
    expect(r.match("DELETE", "/v1/view")).toBeNull();
  });

  it("POST /v1/view/stream does NOT match either", () => {
    expect(r.match("POST", "/v1/view/stream")).toBeNull();
  });

  it("view routes expose ONLY the GET method (no write verb registered)", () => {
    const methods = new Set(viewRoutes(stubDeps).map((rt) => rt.method));
    expect([...methods]).toEqual(["GET"]);
  });
});
