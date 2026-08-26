import { describe, it, expect } from "vitest";
import { normalizeQuality } from "../src/actions.js";

// DEV-0015: captureFrame (the /v1/view + /v1/view/stream building block) hands quality straight to
// Chrome via page.screenshot, which throws on a value outside 1-100 or a non-integer. normalizeQuality
// is the last guard between an arbitrary ?quality= (or SDK caller) and Chrome. Pin the clamp.
describe("normalizeQuality (DEV-0015 view quality clamp)", () => {
  it("passes a valid in-range integer through unchanged", () => {
    expect(normalizeQuality(1)).toBe(1);
    expect(normalizeQuality(50)).toBe(50);
    expect(normalizeQuality(100)).toBe(100);
  });

  it("clamps below 1 up to 1 (0 and negatives never reach Chrome as bad values)", () => {
    expect(normalizeQuality(0)).toBe(1);
    expect(normalizeQuality(-5)).toBe(1);
    expect(normalizeQuality(-999)).toBe(1);
  });

  it("clamps above 100 down to 100", () => {
    expect(normalizeQuality(101)).toBe(100);
    expect(normalizeQuality(999)).toBe(100);
  });

  it("rounds a non-integer to an integer (Chrome wants an int quality)", () => {
    expect(normalizeQuality(59.4)).toBe(59);
    expect(normalizeQuality(59.6)).toBe(60);
    expect(Number.isInteger(normalizeQuality(50.5))).toBe(true);
  });

  it("undefined -> default (no preference)", () => {
    expect(normalizeQuality(undefined)).toBe(60);
    expect(normalizeQuality(undefined, 80)).toBe(80);
  });

  it("NaN/Infinity -> default (not finite, so never reaches Chrome as NaN which throws)", () => {
    expect(normalizeQuality(NaN)).toBe(60);
    expect(normalizeQuality(Infinity)).toBe(60);
    expect(normalizeQuality(-Infinity)).toBe(60);
  });

  it("always returns an integer within [1,100] for any numeric-ish input", () => {
    for (const v of [-1e9, -1, 0, 0.4, 1, 50.7, 100, 100.9, 1e9, NaN, Infinity, -Infinity, undefined]) {
      const q = normalizeQuality(v as number | undefined);
      expect(Number.isInteger(q)).toBe(true);
      expect(q).toBeGreaterThanOrEqual(1);
      expect(q).toBeLessThanOrEqual(100);
    }
  });
});
