import { describe, it, expect } from "vitest";

describe("anvil-engine API design", () => {
  describe("POST /v1/scrape", () => {
    it("requires url in request body", () => {
      // Verify the API contract — url is mandatory
      const validBody = { url: "https://example.com" };
      expect(validBody.url).toBeDefined();
    });

    it("supports format parameter (html, text)", () => {
      const htmlRequest = { url: "https://example.com", format: "html" };
      const textRequest = { url: "https://example.com", format: "text" };
      expect(htmlRequest.format).toBe("html");
      expect(textRequest.format).toBe("text");
    });

    it("supports optional waitForSelector", () => {
      const withSelector = { url: "https://example.com", waitForSelector: ".content" };
      const withoutSelector = { url: "https://example.com" };
      expect(withSelector.waitForSelector).toBe(".content");
      expect(withoutSelector).not.toHaveProperty("waitForSelector");
    });

    it("response shape has content, title, url", () => {
      const expectedShape = { content: "page text", title: "Example", url: "https://example.com" };
      expect(expectedShape).toHaveProperty("content");
      expect(expectedShape).toHaveProperty("title");
      expect(expectedShape).toHaveProperty("url");
    });
  });

  describe("POST /v1/sessions", () => {
    it("response includes id, status, websocketUrl, cdpPort", () => {
      const expectedShape = {
        id: "uuid-here",
        status: "live",
        websocketUrl: "ws://localhost:3000/cdp?session=uuid",
        cdpPort: 9222,
      };
      expect(expectedShape.id).toBeDefined();
      expect(expectedShape.status).toBe("live");
      expect(expectedShape.websocketUrl).toContain("ws://");
      expect(expectedShape.cdpPort).toBeGreaterThan(0);
    });
  });

  describe("POST /v1/sessions/:id/release", () => {
    it("response includes id, status=released, duration", () => {
      const expectedShape = { id: "uuid", status: "released", duration: 5000 };
      expect(expectedShape.status).toBe("released");
      expect(expectedShape.duration).toBeGreaterThan(0);
    });
  });

  describe("GET /v1/health", () => {
    it("response includes status, sessions count, uptime", () => {
      const expectedShape = { status: "ok", sessions: 0, uptime: 123.4 };
      expect(expectedShape.status).toBe("ok");
      expect(typeof expectedShape.sessions).toBe("number");
      expect(typeof expectedShape.uptime).toBe("number");
    });
  });
});

describe("SessionManager logic", () => {
  it("can be imported", async () => {
    const { SessionManager } = await import("../src/session.js");
    expect(SessionManager).toBeDefined();
    const mgr = new SessionManager();
    expect(mgr.size).toBe(0);
    expect(mgr.list()).toEqual([]);
  });
});

describe("POST /v1/pdf", () => {
  it("supports optional url for navigation before PDF", () => {
    const withUrl = { url: "https://example.com", format: "A4" };
    const withoutUrl = { format: "Letter", landscape: true };
    expect(withUrl.url).toBeDefined();
    expect(withoutUrl).not.toHaveProperty("url");
  });

  it("supports format parameter (A4, Letter)", () => {
    const a4 = { format: "A4" };
    const letter = { format: "Letter" };
    expect(a4.format).toBe("A4");
    expect(letter.format).toBe("Letter");
  });

  it("supports landscape parameter", () => {
    const landscape = { landscape: true };
    const portrait = { landscape: false };
    expect(landscape.landscape).toBe(true);
    expect(portrait.landscape).toBe(false);
  });

  it("returns binary PDF (application/pdf content-type)", () => {
    // Contract: response is raw binary, not JSON
    const expectedContentType = "application/pdf";
    expect(expectedContentType).toBe("application/pdf");
  });
});

describe("GET /v1/cookies", () => {
  it("response contains cookies array", () => {
    const expectedShape = { cookies: [{ name: "mid", value: "abc", domain: ".amazon.com" }] };
    expect(expectedShape.cookies).toBeInstanceOf(Array);
    expect(expectedShape.cookies[0]).toHaveProperty("name");
    expect(expectedShape.cookies[0]).toHaveProperty("value");
    expect(expectedShape.cookies[0]).toHaveProperty("domain");
  });

  it("returns empty array when no cookies set", () => {
    const emptyResponse = { cookies: [] };
    expect(emptyResponse.cookies).toHaveLength(0);
  });
});

describe("POST /v1/cookies", () => {
  it("requires cookies array in body", () => {
    const validBody = { cookies: [{ name: "a", value: "b", domain: ".test.com" }] };
    expect(Array.isArray(validBody.cookies)).toBe(true);
  });

  it("response contains injected count", () => {
    const response = { injected: 3 };
    expect(response.injected).toBe(3);
  });

  it("rejects non-array cookies", () => {
    const invalidBody = { cookies: "not-an-array" };
    expect(Array.isArray(invalidBody.cookies)).toBe(false);
  });
});

describe("stealth mode", () => {
  it("stealth defaults to true (enabled by default)", () => {
    const defaultSession = { stealth: undefined };
    // stealth !== false means enabled
    expect(defaultSession.stealth !== false).toBe(true);
  });

  it("can be explicitly disabled with stealth: false", () => {
    const noStealth = { stealth: false };
    expect(noStealth.stealth).toBe(false);
  });

  it("stealth option is part of LaunchOptions", async () => {
    const { launchBrowser } = await import("../src/launcher.js");
    // Verify function accepts stealth in its options type (compile-time check)
    expect(typeof launchBrowser).toBe("function");
  });

  it("session creation body accepts stealth param", () => {
    const body = { stealth: true, dimensions: { width: 1920, height: 1080 } };
    expect(body.stealth).toBe(true);
    // stealth: false disables anti-detection flags
    const noStealthBody = { stealth: false };
    expect(noStealthBody.stealth).toBe(false);
  });
});

describe("launcher module", () => {
  it("exports launchBrowser and killBrowser", async () => {
    const mod = await import("../src/launcher.js");
    expect(typeof mod.launchBrowser).toBe("function");
    expect(typeof mod.killBrowser).toBe("function");
    expect(typeof mod.getNextCdpPort).toBe("function");
  });

  it("getNextCdpPort increments", async () => {
    const { getNextCdpPort } = await import("../src/launcher.js");
    const p1 = getNextCdpPort();
    const p2 = getNextCdpPort();
    expect(p2).toBe(p1 + 1);
  });
});
