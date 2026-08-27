import { describe, it, expect } from "vitest";
import { normalizePdfFormat } from "../src/actions.js";

// HARDEN (parallel to DEV-0015's normalizeQuality): /v1/pdf takes body.format verbatim, and
// page.pdf() THROWS "Unknown paper format" on anything it doesn't recognize — so an arbitrary
// or typo'd format would crash the op with a 500 instead of rendering. normalizePdfFormat is
// the last guard: known formats pass (case-insensitively), everything else falls back to A4.
describe("normalizePdfFormat (PDF paper-format guard)", () => {
  it("passes a known format through, preserving the caller's casing", () => {
    expect(normalizePdfFormat("A4")).toBe("A4");
    expect(normalizePdfFormat("Letter")).toBe("Letter");
    expect(normalizePdfFormat("legal")).toBe("legal");
  });

  it("accepts every Puppeteer paper format case-insensitively", () => {
    for (const f of ["letter", "legal", "tabloid", "ledger", "a0", "a1", "a2", "a3", "a4", "a5", "a6"]) {
      expect(normalizePdfFormat(f.toUpperCase())).toBe(f.toUpperCase());
    }
  });

  it("falls back to A4 on an unknown / typo'd format (would otherwise throw in page.pdf)", () => {
    expect(normalizePdfFormat("A9")).toBe("A4");
    expect(normalizePdfFormat("letr")).toBe("A4");
    expect(normalizePdfFormat("")).toBe("A4");
    expect(normalizePdfFormat("   ")).toBe("A4");
  });

  it("falls back to A4 on a non-string / absent value", () => {
    expect(normalizePdfFormat(undefined)).toBe("A4");
    expect(normalizePdfFormat(123 as unknown as string)).toBe("A4");
    expect(normalizePdfFormat(null as unknown as string)).toBe("A4");
  });

  it("trims surrounding whitespace on an otherwise-valid format", () => {
    expect(normalizePdfFormat("  a4  ")).toBe("a4");
  });

  it("honors a custom default", () => {
    expect(normalizePdfFormat("bogus", "Letter")).toBe("Letter");
  });
});
