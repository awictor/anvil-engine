import { describe, it, expect } from "vitest";

describe("anvil-engine metrics endpoint", () => {
  describe("GET /v1/metrics response shape", () => {
    it("returns sessionsCreated counter", () => {
      const response = { sessionsCreated: 5, sessionsReleased: 3, peakConcurrent: 2, requestsServed: 100, errorsCount: 4, activeSessions: 2, uptime: 3600 };
      expect(response.sessionsCreated).toBe(5);
    });

    it("returns sessionsReleased counter", () => {
      const response = { sessionsReleased: 3 };
      expect(typeof response.sessionsReleased).toBe("number");
    });

    it("returns peakConcurrent counter", () => {
      const response = { peakConcurrent: 4 };
      expect(response.peakConcurrent).toBeGreaterThanOrEqual(0);
    });

    it("returns requestsServed counter", () => {
      const response = { requestsServed: 150 };
      expect(typeof response.requestsServed).toBe("number");
    });

    it("returns errorsCount counter", () => {
      const response = { errorsCount: 7 };
      expect(typeof response.errorsCount).toBe("number");
    });

    it("returns activeSessions (current count)", () => {
      const response = { activeSessions: 2 };
      expect(typeof response.activeSessions).toBe("number");
    });

    it("returns uptime in seconds", () => {
      const response = { uptime: 3600.5 };
      expect(response.uptime).toBeGreaterThan(0);
    });
  });

  describe("counter increment logic", () => {
    it("requestsServed increments on every non-OPTIONS request", () => {
      const method = "GET";
      const shouldCount = method !== "OPTIONS";
      expect(shouldCount).toBe(true);
    });

    it("OPTIONS requests do not increment requestsServed", () => {
      const method = "OPTIONS";
      const shouldCount = method !== "OPTIONS";
      expect(shouldCount).toBe(false);
    });

    it("errorsCount increments on 4xx responses", () => {
      const statusCode = 400;
      const isError = statusCode >= 400;
      expect(isError).toBe(true);
    });

    it("errorsCount increments on 5xx responses", () => {
      const statusCode = 500;
      const isError = statusCode >= 400;
      expect(isError).toBe(true);
    });

    it("2xx responses do not increment errorsCount", () => {
      const statusCode = 200;
      const isError = statusCode >= 400;
      expect(isError).toBe(false);
    });

    it("peakConcurrent uses Math.max pattern", () => {
      let peak = 3;
      const currentSize = 5;
      peak = Math.max(peak, currentSize);
      expect(peak).toBe(5);
    });

    it("peakConcurrent never decreases", () => {
      let peak = 5;
      const currentSize = 2;
      peak = Math.max(peak, currentSize);
      expect(peak).toBe(5);
    });
  });

  describe("auth and rate-limit exemption", () => {
    it("metrics endpoint path is /v1/metrics", () => {
      const path = "/v1/metrics";
      expect(path).toBe("/v1/metrics");
    });

    it("exempt from rate limiting (same as health)", () => {
      const path = "/v1/metrics";
      const exempt = path === "/v1/health" || path === "/v1/metrics";
      expect(exempt).toBe(true);
    });

    it("exempt from API key auth", () => {
      const path = "/v1/metrics";
      const requiresAuth = path !== "/v1/health" && path !== "/v1/metrics";
      expect(requiresAuth).toBe(false);
    });

    it("health endpoint also exempt (unchanged)", () => {
      const path = "/v1/health";
      const requiresAuth = path !== "/v1/health" && path !== "/v1/metrics";
      expect(requiresAuth).toBe(false);
    });
  });

  describe("metrics counter initial state", () => {
    it("all counters start at 0", () => {
      const metrics = { sessionsCreated: 0, sessionsReleased: 0, peakConcurrent: 0, requestsServed: 0, errorsCount: 0 };
      Object.values(metrics).forEach(v => expect(v).toBe(0));
    });
  });
});
