import { describe, it, expect } from "vitest";
import { safeEqual } from "../src/auth-compare.js";

// DEV-0191: constant-time auth-token compare shared by the REST Bearer check + the CDP ?token= check.
describe("safeEqual (DEV-0191)", () => {
  it("true for identical strings", () => {
    expect(safeEqual("s3cret-key", "s3cret-key")).toBe(true);
  });
  it("false for a wrong value of the same length (no early-out)", () => {
    expect(safeEqual("aaaaaa", "aaaaab")).toBe(false);
  });
  it("false (no throw) for a length mismatch — timingSafeEqual needs equal-length buffers", () => {
    expect(safeEqual("short", "a-much-longer-secret")).toBe(false);
    expect(safeEqual("a-much-longer-secret", "short")).toBe(false);
  });
  it("false for empty / undefined / null inputs", () => {
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("x", "")).toBe(false);
    expect(safeEqual(undefined, "x")).toBe(false);
    expect(safeEqual("x", null)).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
  });
  it("handles multi-byte utf8 without throwing", () => {
    expect(safeEqual("kéy", "kéy")).toBe(true);
    expect(safeEqual("kéy", "key")).toBe(false); // different byte length
  });
});
