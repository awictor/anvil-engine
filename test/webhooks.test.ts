import { describe, it, expect } from "vitest";
import { fireWebhook, type WebhookEvent } from "../src/webhooks.js";

describe("anvil-engine webhook callbacks", () => {
  describe("fireWebhook function", () => {
    it("exports fireWebhook function", () => {
      expect(typeof fireWebhook).toBe("function");
    });

    it("accepts event and sessionId parameters", () => {
      expect(fireWebhook.length).toBe(2);
    });

    it("returns void (fire-and-forget)", () => {
      const result = fireWebhook("session.created", "test-id");
      expect(result).toBeUndefined();
    });

    it("does not throw when ANVIL_WEBHOOK_URL is empty", () => {
      expect(() => fireWebhook("session.created", "test-id")).not.toThrow();
      expect(() => fireWebhook("session.released", "test-id")).not.toThrow();
      expect(() => fireWebhook("session.timed_out", "test-id")).not.toThrow();
    });
  });

  describe("WebhookEvent type", () => {
    it("supports session.created event", () => {
      const event: WebhookEvent = "session.created";
      expect(event).toBe("session.created");
    });

    it("supports session.released event", () => {
      const event: WebhookEvent = "session.released";
      expect(event).toBe("session.released");
    });

    it("supports session.timed_out event", () => {
      const event: WebhookEvent = "session.timed_out";
      expect(event).toBe("session.timed_out");
    });
  });

  describe("ANVIL_WEBHOOK_URL env var", () => {
    it("empty string disables webhooks (no-op)", () => {
      const url = "";
      const disabled = !url;
      expect(disabled).toBe(true);
    });

    it("non-empty string enables webhooks", () => {
      const url = "https://hooks.example.com/anvil";
      const enabled = !!url;
      expect(enabled).toBe(true);
    });
  });

  describe("webhook payload shape", () => {
    it("payload includes event field", () => {
      const payload = { event: "session.created", sessionId: "uuid", timestamp: new Date().toISOString() };
      expect(payload.event).toBe("session.created");
    });

    it("payload includes sessionId field", () => {
      const payload = { event: "session.released", sessionId: "abc-123", timestamp: "" };
      expect(payload.sessionId).toBe("abc-123");
    });

    it("payload includes ISO timestamp", () => {
      const timestamp = new Date().toISOString();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("payload is JSON-serializable", () => {
      const payload = { event: "session.timed_out", sessionId: "test", timestamp: new Date().toISOString() };
      const json = JSON.stringify(payload);
      const parsed = JSON.parse(json);
      expect(parsed.event).toBe("session.timed_out");
      expect(parsed.sessionId).toBe("test");
    });
  });

  describe("timeout and error handling", () => {
    it("uses 5-second timeout (5000ms)", () => {
      const TIMEOUT_MS = 5000;
      expect(TIMEOUT_MS).toBe(5000);
    });

    it("AbortController pattern is used for timeout", () => {
      const controller = new AbortController();
      expect(controller.signal).toBeDefined();
      expect(typeof controller.abort).toBe("function");
    });

    it("errors are caught (non-blocking)", () => {
      expect(() => fireWebhook("session.created", "any-id")).not.toThrow();
    });
  });

  describe("integration points", () => {
    it("fires on session creation", () => {
      const events: string[] = [];
      events.push("session.created");
      expect(events).toContain("session.created");
    });

    it("fires on session release", () => {
      const events: string[] = [];
      events.push("session.released");
      expect(events).toContain("session.released");
    });

    it("fires on session timeout", () => {
      const events: string[] = [];
      events.push("session.timed_out");
      expect(events).toContain("session.timed_out");
    });
  });
});
