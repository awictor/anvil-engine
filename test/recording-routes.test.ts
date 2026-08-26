import { describe, it, expect, beforeEach } from "vitest";
import { recordingRoutes } from "../src/routes/recording.js";

// DEV-0076: recording.test.ts asserts string literals and never calls the handlers. This drives the
// real recordingRoutes(deps) handlers with a mock res (DEV-0048 harness) + a fake sessionManager and
// a fake `actions`, asserting each route's documented shape and that it delegates to the matching
// actions method. DEV-0077's no-session guard is folded in as the last block.

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

const ENTRIES = [{ type: "click", selector: "#a" }, { type: "type", selector: "#b", text: "x" }];
let calls: string[];
const fakeSession = { id: "sess-1" } as any;

function deps(hasSession = true) {
  calls = [];
  return {
    sessionManager: { getActive: () => (hasSession ? fakeSession : undefined), get: () => (hasSession ? fakeSession : undefined) },
    actions: {
      startRecording: (s: any) => { calls.push("start:" + s.id); },
      stopRecording: (s: any) => { calls.push("stop:" + s.id); return ENTRIES; },
      getRecording: (s: any) => { calls.push("get:" + s.id); return { recording: true, actions: ENTRIES }; },
    },
  } as any;
}

function route(d: any, pattern: string, method: string) {
  return recordingRoutes(d).find((r: any) => r.pattern === pattern && r.method === method)!;
}
const ctx = (r: any) => ({ req: { headers: {} }, res: r.res, url: new URL("http://x/"), params: {}, requestId: "t" });

describe("recordingRoutes handlers (DEV-0076)", () => {
  it("POST /v1/recording/start -> 200 {recording:true, sessionId} and calls startRecording", () => {
    const r = mkRes();
    route(deps(), "/v1/recording/start", "POST").handler(ctx(r));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ recording: true, sessionId: "sess-1" });
    expect(calls).toEqual(["start:sess-1"]);
  });

  it("POST /v1/recording/stop -> 200 {recording:false, actions:count} and calls stopRecording", () => {
    const r = mkRes();
    route(deps(), "/v1/recording/stop", "POST").handler(ctx(r));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ recording: false, actions: ENTRIES.length });
    expect(calls).toEqual(["stop:sess-1"]);
  });

  it("GET /v1/recording -> 200 {recording, actions} and calls getRecording", () => {
    const r = mkRes();
    route(deps(), "/v1/recording", "GET").handler(ctx(r));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ recording: true, actions: ENTRIES });
    expect(calls).toEqual(["get:sess-1"]);
  });

  // DEV-0077: every recording route is session-scoped via resolveSession; no active session -> 400.
  it("all three routes return 400 'No active session' when the session manager is empty", () => {
    for (const [pattern, method] of [["/v1/recording/start", "POST"], ["/v1/recording/stop", "POST"], ["/v1/recording", "GET"]] as const) {
      const r = mkRes();
      route(deps(false), pattern, method).handler(ctx(r));
      expect(r.status, `${method} ${pattern}`).toBe(400);
      expect(r.json.error).toBe("No active session");
    }
  });
});
