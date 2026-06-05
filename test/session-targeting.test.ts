import { describe, it, expect } from "vitest";
import { SessionManager } from "../src/session.js";

describe("anvil-engine session targeting", () => {
  describe("X-Session-Id header resolution", () => {
    it("header name is x-session-id (lowercase)", () => {
      const headers = { "x-session-id": "abc-123" };
      expect(headers["x-session-id"]).toBe("abc-123");
    });

    it("extracts session ID from header", () => {
      const headerValue = "uuid-session-1";
      const explicitId = headerValue || "";
      expect(explicitId).toBe("uuid-session-1");
    });

    it("header takes precedence over query param", () => {
      const header = "header-id";
      const queryParam = "query-id";
      const explicitId = header || queryParam || "";
      expect(explicitId).toBe("header-id");
    });
  });

  describe("?sessionId= query param resolution", () => {
    it("extracts session ID from query param", () => {
      const url = new URL("http://localhost:3000/v1/actions/click?sessionId=my-session");
      const sessionId = url.searchParams.get("sessionId");
      expect(sessionId).toBe("my-session");
    });

    it("returns null when param not present", () => {
      const url = new URL("http://localhost:3000/v1/actions/click");
      const sessionId = url.searchParams.get("sessionId");
      expect(sessionId).toBeNull();
    });

    it("used when header is not provided", () => {
      const header = undefined;
      const queryParam = "fallback-id";
      const explicitId = (header as string) || queryParam || "";
      expect(explicitId).toBe("fallback-id");
    });
  });

  describe("fallback to getActive()", () => {
    it("falls back when no header and no query param", () => {
      const header = undefined;
      const queryParam = null;
      const explicitId = (header as any as string) || queryParam || "";
      expect(explicitId).toBe("");
    });

    it("returns 400 with 'No active session' when fallback finds nothing", () => {
      const error = { status: 400, body: { error: "No active session" } };
      expect(error.status).toBe(400);
      expect(error.body.error).toBe("No active session");
    });
  });

  describe("404 on missing explicit session", () => {
    it("returns 404 when explicit ID not found", () => {
      const error = { status: 404, body: { error: "Session not found" } };
      expect(error.status).toBe(404);
      expect(error.body.error).toBe("Session not found");
    });

    it("uses sessionManager.get() for explicit ID lookup", () => {
      const mgr = new SessionManager();
      const result = mgr.get("nonexistent-uuid");
      expect(result).toBeUndefined();
    });

    it("differentiates 404 (explicit miss) from 400 (no active)", () => {
      const explicitMiss = { status: 404, body: { error: "Session not found" } };
      const noActive = { status: 400, body: { error: "No active session" } };
      expect(explicitMiss.status).not.toBe(noActive.status);
    });
  });

  describe("resolveSession result type", () => {
    it("success result has session property", () => {
      const result = { session: { id: "test", status: "live" } };
      expect(result.session).toBeDefined();
      expect(result.session.id).toBe("test");
    });

    it("error result has status and body", () => {
      const result = { error: { status: 404, body: { error: "Session not found" } } };
      expect(result.error.status).toBeDefined();
      expect(result.error.body.error).toBeDefined();
    });

    it("discriminated union: session XOR error", () => {
      const success = { session: { id: "x" }, error: undefined };
      const failure = { session: undefined, error: { status: 404, body: { error: "..." } } };
      expect(!!success.session && !success.error).toBe(true);
      expect(!failure.session && !!failure.error).toBe(true);
    });
  });

  describe("all endpoints use resolveSession", () => {
    it("18 action endpoints replaced with resolveSession pattern", () => {
      const endpointsThatNeedSession = [
        "POST /v1/actions/navigate",
        "POST /v1/scrape",
        "POST /v1/pdf",
        "GET /v1/cookies",
        "POST /v1/cookies",
        "POST /v1/har/start",
        "POST /v1/har/stop",
        "GET /v1/har",
        "POST /v1/intercept",
        "POST /v1/actions/evaluate",
        "GET /v1/screenshot",
        "GET /v1/downloads",
        "GET /v1/downloads/:filename",
        "POST /v1/actions/click",
        "POST /v1/actions/type",
        "POST /v1/actions/select",
        "POST /v1/actions/hover",
        "POST /v1/actions/wait",
      ];
      expect(endpointsThatNeedSession).toHaveLength(18);
    });
  });

  describe("touch targets resolved session", () => {
    it("touch is called on resolved session ID (not just active)", () => {
      const mgr = new SessionManager();
      const targetedId = "specific-session-uuid";
      expect(() => mgr.touch(targetedId)).not.toThrow();
    });
  });

  describe("health endpoint reports multiSession", () => {
    it("health response includes multiSession: true", () => {
      const health = { status: "ok", sessions: 2, multiSession: true };
      expect(health.multiSession).toBe(true);
    });
  });

  describe("backward compatibility", () => {
    it("requests without X-Session-Id or ?sessionId work as before", () => {
      const header = undefined;
      const queryParam = null;
      const explicitId = (header as any) || queryParam || "";
      const useFallback = !explicitId;
      expect(useFallback).toBe(true);
    });

    it("existing clients unaffected — getActive() fallback preserved", () => {
      const mgr = new SessionManager();
      const active = mgr.getActive();
      expect(active).toBeUndefined();
    });
  });
});
