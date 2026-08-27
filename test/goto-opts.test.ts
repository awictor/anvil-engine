import { describe, it, expect } from "vitest";
import { gotoOpts } from "../src/actions.js";

// DEV-0132: gotoOpts is the guard that lets a caller pick a faster page.goto wait strategy /
// shorter timeout (so a polling page — HN etc, never network-idle — can't burn the full 60s)
// while defaulting to the prior networkidle2/60000 when omitted. Mirrors navigate()'s clamp.
describe("gotoOpts (PDF/scrape goto option guard)", () => {
  it("defaults to networkidle2 / 60000 when both omitted (no behavior change for existing callers)", () => {
    expect(gotoOpts(undefined, undefined)).toEqual({ waitUntil: "networkidle2", timeout: 60000 });
  });

  it("passes a valid waitUntil through", () => {
    expect(gotoOpts("domcontentloaded", undefined).waitUntil).toBe("domcontentloaded");
    for (const w of ["load", "domcontentloaded", "networkidle0", "networkidle2"]) {
      expect(gotoOpts(w, undefined).waitUntil).toBe(w);
    }
  });

  it("falls back to networkidle2 on an unknown waitUntil", () => {
    expect(gotoOpts("bogus", undefined).waitUntil).toBe("networkidle2");
    expect(gotoOpts("", undefined).waitUntil).toBe("networkidle2");
  });

  it("clamps a positive timeout to at most 60000", () => {
    expect(gotoOpts(undefined, 5000).timeout).toBe(5000);
    expect(gotoOpts(undefined, 999999).timeout).toBe(60000);
    expect(gotoOpts(undefined, 60000).timeout).toBe(60000);
  });

  it("falls back to the default timeout on 0 / negative / non-finite", () => {
    expect(gotoOpts(undefined, 0).timeout).toBe(60000);
    expect(gotoOpts(undefined, -5).timeout).toBe(60000);
    expect(gotoOpts(undefined, NaN).timeout).toBe(60000);
    expect(gotoOpts(undefined, Infinity).timeout).toBe(60000);
  });

  it("honors a custom default timeout", () => {
    expect(gotoOpts(undefined, undefined, 30000).timeout).toBe(30000);
  });

  it("combines a caller waitUntil + clamped timeout", () => {
    expect(gotoOpts("domcontentloaded", 123456)).toEqual({ waitUntil: "domcontentloaded", timeout: 60000 });
  });
});
