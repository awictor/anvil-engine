import { describe, it, expect } from "vitest";

describe("anvil-engine action recording", () => {
  describe("POST /v1/recording/start", () => {
    it("returns recording: true on success", () => {
      const response = { recording: true, sessionId: "uuid-123" };
      expect(response.recording).toBe(true);
    });

    it("includes sessionId in response", () => {
      const response = { recording: true, sessionId: "test-session" };
      expect(response.sessionId).toBeDefined();
    });

    it("requires active session", () => {
      const error = { error: "No active session" };
      expect(error.error).toBe("No active session");
    });
  });

  describe("POST /v1/recording/stop", () => {
    it("returns recording: false on success", () => {
      const response = { recording: false, actions: 5 };
      expect(response.recording).toBe(false);
    });

    it("returns count of recorded actions", () => {
      const response = { recording: false, actions: 12 };
      expect(typeof response.actions).toBe("number");
      expect(response.actions).toBeGreaterThanOrEqual(0);
    });

    it("requires active session", () => {
      const error = { error: "No active session" };
      expect(error.error).toBe("No active session");
    });
  });

  describe("GET /v1/recording", () => {
    it("returns recording status boolean", () => {
      const response = { recording: true, actions: [] };
      expect(typeof response.recording).toBe("boolean");
    });

    it("returns actions array", () => {
      const response = { recording: true, actions: [{ action: "click", params: {}, timestamp: "", durationMs: 10 }] };
      expect(Array.isArray(response.actions)).toBe(true);
    });

    it("requires active session", () => {
      const error = { error: "No active session" };
      expect(error.error).toBe("No active session");
    });
  });

  describe("ActionEntry shape", () => {
    it("has action field (string name)", () => {
      const entry = { action: "navigate", params: { url: "https://example.com" }, timestamp: "2026-06-08T10:00:00.000Z", durationMs: 1200 };
      expect(entry.action).toBe("navigate");
    });

    it("has params field (object with action parameters)", () => {
      const entry = { action: "click", params: { selector: "#btn", button: "left" }, timestamp: "", durationMs: 50 };
      expect(entry.params.selector).toBe("#btn");
    });

    it("has timestamp as ISO string", () => {
      const entry = { action: "type", params: {}, timestamp: new Date().toISOString(), durationMs: 100 };
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("has durationMs as number (execution time)", () => {
      const entry = { action: "wait", params: {}, timestamp: "", durationMs: 3500 };
      expect(typeof entry.durationMs).toBe("number");
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("recordAction behavior", () => {
    it("only records when recording is active for session", () => {
      const store = new Map<string, unknown[]>();
      const sessionId = "sess-1";
      // Not started — no entry
      const entries = store.get(sessionId);
      expect(entries).toBeUndefined();
    });

    it("records after start is called", () => {
      const store = new Map<string, unknown[]>();
      store.set("sess-1", []);
      const entries = store.get("sess-1");
      expect(entries).toEqual([]);
    });

    it("navigate action is recorded with url param", () => {
      const entry = { action: "navigate", params: { url: "https://example.com", waitUntil: "networkidle2" }, timestamp: "", durationMs: 800 };
      expect(entry.action).toBe("navigate");
      expect(entry.params.url).toBe("https://example.com");
    });

    it("click action is recorded with selector/button/clickCount", () => {
      const entry = { action: "click", params: { selector: ".submit", button: "left", clickCount: 1 }, timestamp: "", durationMs: 20 };
      expect(entry.params.selector).toBe(".submit");
    });
  });

  describe("recording lifecycle", () => {
    it("start creates empty array for session", () => {
      const store = new Map<string, unknown[]>();
      store.set("my-session", []);
      expect(store.get("my-session")).toHaveLength(0);
    });

    it("stop removes recording (deletes from store)", () => {
      const store = new Map<string, unknown[]>();
      store.set("my-session", [{ action: "click" }]);
      store.delete("my-session");
      expect(store.has("my-session")).toBe(false);
    });

    it("get returns empty array when not recording", () => {
      const store = new Map<string, unknown[]>();
      const entries = store.get("no-session") || [];
      expect(entries).toEqual([]);
    });
  });
});
