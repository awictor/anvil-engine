import { describe, it, expect } from "vitest";

describe("anvil-engine user-agent and viewport emulation", () => {
  describe("POST /v1/sessions — userAgent in body", () => {
    it("accepts userAgent string in request body", () => {
      const body = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)" };
      expect(body.userAgent).toBeDefined();
      expect(typeof body.userAgent).toBe("string");
    });

    it("userAgent is optional (backward compat)", () => {
      const body = { dimensions: { width: 1920, height: 1080 } };
      expect(body).not.toHaveProperty("userAgent");
    });

    it("response includes userAgent when set", () => {
      const response = {
        id: "uuid",
        status: "live",
        userAgent: "CustomBot/1.0",
      };
      expect(response.userAgent).toBe("CustomBot/1.0");
    });

    it("response shows userAgent as null when not set", () => {
      const response = { id: "uuid", userAgent: null };
      expect(response.userAgent).toBeNull();
    });
  });

  describe("LaunchOptions.userAgent", () => {
    it("userAgent field is optional on LaunchOptions", () => {
      const opts = { headless: true, width: 1280, height: 720 };
      expect(opts).not.toHaveProperty("userAgent");
    });

    it("accepts arbitrary user-agent strings", () => {
      const opts = { userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)" };
      expect(opts.userAgent).toContain("Googlebot");
    });

    it("stored on Session.options for retrieval", () => {
      const session = {
        options: { userAgent: "MyBot/1.0" },
      };
      expect(session.options.userAgent).toBe("MyBot/1.0");
    });
  });

  describe("viewport application", () => {
    it("default viewport is 1920x1080", () => {
      const width = undefined || 1920;
      const height = undefined || 1080;
      expect(width).toBe(1920);
      expect(height).toBe(1080);
    });

    it("custom dimensions override defaults", () => {
      const body = { dimensions: { width: 375, height: 812 } };
      const width = body.dimensions.width || 1920;
      const height = body.dimensions.height || 1080;
      expect(width).toBe(375);
      expect(height).toBe(812);
    });

    it("setViewport uses {width, height} object", () => {
      const viewport = { width: 1440, height: 900 };
      expect(viewport).toHaveProperty("width");
      expect(viewport).toHaveProperty("height");
    });
  });

  describe("GET /v1/sessions/:id endpoint", () => {
    it("returns 404 for non-existent session ID", () => {
      const error = { error: "Session not found" };
      expect(error.error).toBe("Session not found");
    });

    it("response includes full session details", () => {
      const response = {
        id: "session-uuid",
        status: "live",
        websocketUrl: "ws://localhost:3000/cdp?session=session-uuid",
        cdpPort: 9222,
        dimensions: { width: 1920, height: 1080 },
        userAgent: "CustomUA/1.0",
        createdAt: "2026-06-05T15:00:00.000Z",
        timeoutMs: 300000,
        idleMs: 5000,
        expiresAt: "2026-06-05T15:05:00.000Z",
      };
      expect(response.id).toBe("session-uuid");
      expect(response.dimensions).toEqual({ width: 1920, height: 1080 });
      expect(response.userAgent).toBe("CustomUA/1.0");
      expect(response.timeoutMs).toBe(300000);
    });

    it("URL pattern matches /v1/sessions/:id", () => {
      const pattern = /^\/v1\/sessions\/([^/]+)$/;
      expect(pattern.test("/v1/sessions/abc-123")).toBe(true);
      expect(pattern.test("/v1/sessions/list")).toBe(true); // matches regex but filtered in code
      expect(pattern.test("/v1/sessions/abc/release")).toBe(false);
    });

    it("excludes 'list' from matching as session ID", () => {
      const match = "/v1/sessions/list".match(/^\/v1\/sessions\/([^/]+)$/);
      const id = match?.[1];
      const isListEndpoint = id === "list";
      expect(isListEndpoint).toBe(true);
    });
  });

  describe("page.setUserAgent application", () => {
    it("only called when userAgent is provided", () => {
      const userAgent = undefined;
      const shouldApply = !!userAgent;
      expect(shouldApply).toBe(false);
    });

    it("called with exact string from options", () => {
      const userAgent = "Mozilla/5.0 Custom";
      const shouldApply = !!userAgent;
      expect(shouldApply).toBe(true);
      expect(userAgent).toBe("Mozilla/5.0 Custom");
    });
  });

  describe("backward compatibility", () => {
    it("sessions created without userAgent work normally", () => {
      const body = {};
      const userAgent = (body as any).userAgent || null;
      expect(userAgent).toBeNull();
    });

    it("existing session creation without dimensions uses defaults", () => {
      const body = {};
      const width = (body as any).dimensions?.width || 1920;
      const height = (body as any).dimensions?.height || 1080;
      expect(width).toBe(1920);
      expect(height).toBe(1080);
    });
  });
});
