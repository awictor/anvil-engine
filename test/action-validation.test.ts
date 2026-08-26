import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { actionRoutes } from "../src/routes/actions.js";

// DEV-0115: the action routes validate BEFORE touching the browser (select needs a string selector +
// an array `values`; hover + wait need a string selector). page-actions.test only asserted on a
// hand-built {error} literal — it drove NO handler, so a broken guard would pass. This drives the REAL
// actionRoutes handlers with a mock req (Readable body) + mock res and a spying `actions` that FAILS
// if any method is called on a rejected path — the same harness as content-validation.test.

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

// actions that throws if ANY method runs — proves validation short-circuits before the browser.
const explodingActions = new Proxy({}, { get() { return () => { throw new Error("actions must not be called on a rejected request"); }; } });
const deps = { sessionManager: { getActive: () => ({ id: "s" }), get: () => ({ id: "s" }) }, actions: explodingActions } as any;

function route(pattern: string) {
  return actionRoutes(deps).find((r: any) => r.pattern === pattern && r.method === "POST")!;
}
const ctx = (req: any, r: any) => ({ req, res: r.res, url: new URL("http://x/"), params: {}, requestId: "t" });

describe("action route validation (DEV-0115) — real handlers, no browser", () => {
  it("POST /v1/actions/select rejects a missing selector with 400", async () => {
    const r = mkRes();
    await route("/v1/actions/select").handler(ctx(mkReq({ values: ["a"] }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/selector must be a non-empty string/);
  });

  it("POST /v1/actions/select rejects non-array values with 400 (the untested guard)", async () => {
    const r = mkRes();
    await route("/v1/actions/select").handler(ctx(mkReq({ selector: "#s", values: "not-an-array" }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/values must be an array/);
  });

  it("POST /v1/actions/hover rejects a missing selector with 400", async () => {
    const r = mkRes();
    await route("/v1/actions/hover").handler(ctx(mkReq({}), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/selector must be a non-empty string/);
  });

  it("POST /v1/actions/wait rejects a non-string selector with 400", async () => {
    const r = mkRes();
    await route("/v1/actions/wait").handler(ctx(mkReq({ selector: 123 }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/selector must be a non-empty string/);
  });

  // DEV-0116: click + type validation was only "tested" by page-actions.test's literal theater
  // (imported no src). Drive the real handlers here.
  it("POST /v1/actions/click rejects a missing selector with 400", async () => {
    const r = mkRes();
    await route("/v1/actions/click").handler(ctx(mkReq({ button: "left" }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/selector must be a non-empty string/);
  });

  it("POST /v1/actions/type rejects a missing selector with 400", async () => {
    const r = mkRes();
    await route("/v1/actions/type").handler(ctx(mkReq({ text: "hi" }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/selector must be a non-empty string/);
  });

  it("POST /v1/actions/type rejects a missing text with 400 (selector present)", async () => {
    const r = mkRes();
    await route("/v1/actions/type").handler(ctx(mkReq({ selector: "#in" }), r));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/text must be a non-empty string/);
  });
});
