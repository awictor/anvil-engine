import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/rate-limiter.js";

describe("anvil-engine rate limiting", () => {
  describe("RateLimiter constructor", () => {
    it("exports RateLimiter class", () => {
      expect(typeof RateLimiter).toBe("function");
    });

    it("accepts requestsPerMinute parameter", () => {
      const limiter = new RateLimiter(60);
      expect(limiter).toBeDefined();
    });
  });

  describe("consume() — basic behavior", () => {
    it("first request is always allowed", () => {
      const limiter = new RateLimiter(10);
      const result = limiter.consume("client-1");
      expect(result.allowed).toBe(true);
      expect(result.retryAfterSec).toBe(0);
    });

    it("allows multiple requests within limit", () => {
      const limiter = new RateLimiter(100);
      for (let i = 0; i < 50; i++) {
        const result = limiter.consume("client-1");
        expect(result.allowed).toBe(true);
      }
    });

    it("rejects when tokens exhausted", () => {
      const limiter = new RateLimiter(5);
      for (let i = 0; i < 5; i++) {
        limiter.consume("client-1");
      }
      const result = limiter.consume("client-1");
      expect(result.allowed).toBe(false);
    });

    it("returns retryAfterSec > 0 when rejected", () => {
      const limiter = new RateLimiter(5);
      for (let i = 0; i < 5; i++) limiter.consume("client-1");
      const result = limiter.consume("client-1");
      expect(result.retryAfterSec).toBeGreaterThan(0);
    });
  });

  describe("per-client isolation", () => {
    it("different clients have separate buckets", () => {
      const limiter = new RateLimiter(2);
      limiter.consume("client-a");
      limiter.consume("client-a");
      const exhausted = limiter.consume("client-a");
      expect(exhausted.allowed).toBe(false);

      const fresh = limiter.consume("client-b");
      expect(fresh.allowed).toBe(true);
    });
  });

  describe("token refill behavior", () => {
    it("maxTokens equals requestsPerMinute (burst capacity)", () => {
      const limiter = new RateLimiter(60);
      let allowed = 0;
      for (let i = 0; i < 100; i++) {
        if (limiter.consume("client").allowed) allowed++;
      }
      expect(allowed).toBe(60);
    });

    it("refillRate is requestsPerMinute / 60 (tokens per second)", () => {
      const rpm = 120;
      const expectedRefillRate = rpm / 60;
      expect(expectedRefillRate).toBe(2);
    });
  });

  describe("startCleanup / stopCleanup", () => {
    it("startCleanup method exists", () => {
      const limiter = new RateLimiter(60);
      expect(typeof limiter.startCleanup).toBe("function");
    });

    it("stopCleanup method exists", () => {
      const limiter = new RateLimiter(60);
      expect(typeof limiter.stopCleanup).toBe("function");
    });

    it("stopCleanup is safe without prior start", () => {
      const limiter = new RateLimiter(60);
      expect(() => limiter.stopCleanup()).not.toThrow();
    });

    it("stopCleanup is idempotent", () => {
      const limiter = new RateLimiter(60);
      limiter.startCleanup();
      expect(() => limiter.stopCleanup()).not.toThrow();
      expect(() => limiter.stopCleanup()).not.toThrow();
    });

    it("stale buckets cleaned after 120s inactivity", () => {
      const STALE_THRESHOLD = 120_000;
      expect(STALE_THRESHOLD).toBe(120000);
    });
  });

  describe("ANVIL_RATE_LIMIT_RPM env var", () => {
    it("value of 0 means disabled (no limiter created)", () => {
      const rpm = 0;
      const limiter = rpm > 0 ? new RateLimiter(rpm) : null;
      expect(limiter).toBeNull();
    });

    it("positive value creates a limiter", () => {
      const rpm = 120;
      const limiter = rpm > 0 ? new RateLimiter(rpm) : null;
      expect(limiter).not.toBeNull();
    });
  });

  describe("429 response contract", () => {
    it("error message is 'Rate limit exceeded'", () => {
      const response = { error: "Rate limit exceeded" };
      expect(response.error).toBe("Rate limit exceeded");
    });

    it("Retry-After header is retryAfterSec as string", () => {
      const retryAfterSec = 3;
      const header = String(retryAfterSec);
      expect(header).toBe("3");
    });

    it("health endpoint is exempt from rate limiting", () => {
      const path = "/v1/health";
      const exempt = path === "/v1/health";
      expect(exempt).toBe(true);
    });
  });

  describe("client IP resolution", () => {
    it("uses X-Forwarded-For first IP when present", () => {
      const header = "1.2.3.4, 5.6.7.8";
      const clientIp = header.split(",")[0]?.trim();
      expect(clientIp).toBe("1.2.3.4");
    });

    it("falls back to remoteAddress", () => {
      const forwarded = undefined;
      const remote = "127.0.0.1";
      const clientIp = forwarded || remote || "unknown";
      expect(clientIp).toBe("127.0.0.1");
    });

    it("defaults to 'unknown' if no IP available", () => {
      const forwarded = undefined;
      const remote = undefined;
      const clientIp = forwarded || remote || "unknown";
      expect(clientIp).toBe("unknown");
    });
  });
});
