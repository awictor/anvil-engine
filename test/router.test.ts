import { describe, it, expect } from "vitest";
import { Router } from "../src/router.js";
import type { RouteHandler } from "../src/router.js";

// DEV-0031 (HARDEN): Router.match is the core dispatcher — static segments, ':name' params,
// trailing '*name' rest-capture, first-match-wins by registration order, method-mismatch -> null.
// Tested only indirectly by route-contract suites; this pins the param/rest/precedence logic head-on.

const H = (tag: string): RouteHandler => (() => { void tag; }) as RouteHandler;

describe("Router.match (DEV-0031)", () => {
  it("registration-order precedence: a static route wins over a :param when registered first", () => {
    const r = new Router();
    r.add("GET", "/v1/sessions/list", H("list"));
    r.add("GET", "/v1/sessions/:id", H("byId"));
    const list = r.match("GET", "/v1/sessions/list");
    expect(list).not.toBeNull();
    expect(list!.params).toEqual({}); // matched the static route, no :id captured
    const byId = r.match("GET", "/v1/sessions/abc123");
    expect(byId!.params).toEqual({ id: "abc123" });
  });

  it("if the :param is registered FIRST it wins (first-match, order is load-bearing)", () => {
    const r = new Router();
    r.add("GET", "/v1/sessions/:id", H("byId"));
    r.add("GET", "/v1/sessions/list", H("list"));
    // /list now matches the :id route first -> captured as an id (documents why order matters)
    expect(r.match("GET", "/v1/sessions/list")!.params).toEqual({ id: "list" });
  });

  it("captures a :name segment", () => {
    const r = new Router();
    r.add("DELETE", "/v1/contexts/:id", H("del"));
    expect(r.match("DELETE", "/v1/contexts/ctx-9")!.params).toEqual({ id: "ctx-9" });
  });

  it("captures a trailing *rest as the joined remaining path", () => {
    const r = new Router();
    r.add("GET", "/v1/files/*path", H("files"));
    const m = r.match("GET", "/v1/files/a/b/c.txt");
    expect(m).not.toBeNull();
    expect(m!.params).toEqual({ path: "a/b/c.txt" });
  });

  it("returns null on segment-count mismatch (too many / too few)", () => {
    const r = new Router();
    r.add("GET", "/v1/a/:x", H("a"));
    expect(r.match("GET", "/v1/a")).toBeNull();        // too few
    expect(r.match("GET", "/v1/a/x/y")).toBeNull();    // too many
  });

  it("returns null on method mismatch (wrong verb is a 404, not a 405)", () => {
    const r = new Router();
    r.add("POST", "/v1/thing", H("t"));
    expect(r.match("GET", "/v1/thing")).toBeNull();
    expect(r.match("POST", "/v1/thing")).not.toBeNull();
  });

  it("ignores leading/trailing slashes (split+filter(Boolean))", () => {
    const r = new Router();
    r.add("GET", "/v1/ping", H("p"));
    expect(r.match("GET", "/v1/ping/")).not.toBeNull();
    expect(r.match("GET", "v1/ping")).not.toBeNull();
  });

  it("returns null when nothing is registered", () => {
    expect(new Router().match("GET", "/anything")).toBeNull();
  });
});
