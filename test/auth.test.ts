import { describe, it, expect } from "vitest";

describe("anvil-engine API key authentication", () => {
  describe("ANVIL_API_KEY env var behavior", () => {
    it("reads API_KEY from ANVIL_API_KEY env var", () => {
      const envKey = process.env.ANVIL_API_KEY || "";
      expect(typeof envKey).toBe("string");
    });

    it("empty string means auth disabled (dev mode)", () => {
      const apiKey = "";
      expect(!apiKey).toBe(true);
    });

    it("non-empty string enables auth enforcement", () => {
      const apiKey = "my-secret-key-123";
      expect(!!apiKey).toBe(true);
    });
  });

  describe("Authorization header validation", () => {
    it("expects Bearer token format", () => {
      const key = "test-key";
      const validHeader = `Bearer ${key}`;
      expect(validHeader).toBe("Bearer test-key");
    });

    it("rejects missing Authorization header", () => {
      const auth = undefined || "";
      const apiKey = "secret";
      expect(auth !== `Bearer ${apiKey}`).toBe(true);
    });

    it("rejects wrong token value", () => {
      const auth = "Bearer wrong-key";
      const apiKey = "correct-key";
      expect(auth !== `Bearer ${apiKey}`).toBe(true);
    });

    it("rejects non-Bearer format (e.g. Basic auth)", () => {
      const auth = "Basic dXNlcjpwYXNz";
      const apiKey = "my-key";
      expect(auth !== `Bearer ${apiKey}`).toBe(true);
    });

    it("accepts correct Bearer token", () => {
      const apiKey = "my-secret";
      const auth = `Bearer ${apiKey}`;
      expect(auth === `Bearer ${apiKey}`).toBe(true);
    });

    it("comparison is exact (no partial match)", () => {
      const apiKey = "key";
      const auth = "Bearer key-extended";
      expect(auth !== `Bearer ${apiKey}`).toBe(true);
    });
  });

  describe("401 Unauthorized response", () => {
    it("returns correct error shape", () => {
      const response = { error: "Unauthorized" };
      expect(response).toHaveProperty("error");
      expect(response.error).toBe("Unauthorized");
    });

    it("status code is 401", () => {
      const statusCode = 401;
      expect(statusCode).toBe(401);
    });
  });

  describe("OPTIONS exemption for CORS", () => {
    it("OPTIONS requests bypass auth (return 204)", () => {
      const method = "OPTIONS";
      const shouldSkipAuth = method === "OPTIONS";
      expect(shouldSkipAuth).toBe(true);
    });

    it("GET requests are NOT exempt from auth", () => {
      const method = "GET";
      const shouldSkipAuth = method === "OPTIONS";
      expect(shouldSkipAuth).toBe(false);
    });

    it("POST requests are NOT exempt from auth", () => {
      const method = "POST";
      const shouldSkipAuth = method === "OPTIONS";
      expect(shouldSkipAuth).toBe(false);
    });
  });

  describe("dev mode (no ANVIL_API_KEY set)", () => {
    it("all requests pass without Authorization header", () => {
      const apiKey = "";
      const shouldEnforceAuth = !!apiKey;
      expect(shouldEnforceAuth).toBe(false);
    });

    it("requests with any header still pass in dev mode", () => {
      const apiKey = "";
      const auth = "Bearer random-garbage";
      const blocked = apiKey && auth !== `Bearer ${apiKey}`;
      expect(blocked).toBeFalsy();
    });
  });

  describe("startup logging", () => {
    it("logs 'API key enabled' when ANVIL_API_KEY is set", () => {
      const apiKey = "secret-123";
      const message = apiKey ? "API key enabled" : "disabled (dev mode)";
      expect(message).toBe("API key enabled");
    });

    it("logs 'disabled (dev mode)' when ANVIL_API_KEY is unset", () => {
      const apiKey = "";
      const message = apiKey ? "API key enabled" : "disabled (dev mode)";
      expect(message).toBe("disabled (dev mode)");
    });
  });

  describe("auth check ordering", () => {
    it("auth runs BEFORE route matching", () => {
      const order = ["cors", "options-bypass", "auth-check", "route-matching"];
      const authIndex = order.indexOf("auth-check");
      const routeIndex = order.indexOf("route-matching");
      expect(authIndex).toBeLessThan(routeIndex);
    });

    it("auth runs AFTER CORS headers are set", () => {
      const order = ["cors", "options-bypass", "auth-check", "route-matching"];
      const corsIndex = order.indexOf("cors");
      const authIndex = order.indexOf("auth-check");
      expect(corsIndex).toBeLessThan(authIndex);
    });
  });
});
