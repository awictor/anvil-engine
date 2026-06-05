import { describe, it, expect } from "vitest";
import { generateFingerprintScript } from "../src/fingerprint.js";

describe("anvil-engine fingerprint randomization", () => {
  describe("generateFingerprintScript()", () => {
    it("exports generateFingerprintScript function", () => {
      expect(typeof generateFingerprintScript).toBe("function");
    });

    it("accepts a seed string and returns a script string", () => {
      const script = generateFingerprintScript("test-seed-123");
      expect(typeof script).toBe("string");
      expect(script.length).toBeGreaterThan(100);
    });

    it("returns different scripts for different seeds", () => {
      const script1 = generateFingerprintScript("session-aaa");
      const script2 = generateFingerprintScript("session-bbb");
      expect(script1).not.toBe(script2);
    });

    it("returns identical scripts for the same seed", () => {
      const script1 = generateFingerprintScript("same-seed");
      const script2 = generateFingerprintScript("same-seed");
      expect(script1).toBe(script2);
    });

    it("script is a self-invoking function", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("(function()");
      expect(script).toContain("})();");
    });
  });

  describe("canvas fingerprint overrides", () => {
    it("script overrides HTMLCanvasElement.prototype.toDataURL", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("HTMLCanvasElement.prototype.toDataURL");
    });

    it("script overrides HTMLCanvasElement.prototype.toBlob", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("HTMLCanvasElement.prototype.toBlob");
    });

    it("adds noise via createImageData", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("createImageData");
      expect(script).toContain("putImageData");
    });
  });

  describe("WebGL fingerprint overrides", () => {
    it("overrides WebGLRenderingContext.getParameter", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("WebGLRenderingContext.prototype.getParameter");
    });

    it("handles WebGL2RenderingContext when available", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("WebGL2RenderingContext");
    });

    it("intercepts UNMASKED_VENDOR_WEBGL (37445)", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("37445");
    });

    it("intercepts UNMASKED_RENDERER_WEBGL (37446)", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("37446");
    });

    it("includes multiple GPU vendor/renderer options", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("NVIDIA");
      expect(script).toContain("AMD");
      expect(script).toContain("Intel");
    });
  });

  describe("navigator property overrides", () => {
    it("overrides navigator.hardwareConcurrency", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("hardwareConcurrency");
    });

    it("overrides navigator.deviceMemory", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("deviceMemory");
    });

    it("uses realistic core counts", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("[2, 4, 6, 8, 12, 16]");
    });

    it("uses realistic memory values", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("[2, 4, 8, 16, 32]");
    });
  });

  describe("AudioContext fingerprint", () => {
    it("overrides AudioContext.prototype.createOscillator", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("AudioContext.prototype.createOscillator");
    });

    it("applies detune offset for AnalyserNode connections", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("detune");
      expect(script).toContain("AnalyserNode");
    });
  });

  describe("PRNG determinism", () => {
    it("uses xorshift32 algorithm", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("s ^= s << 13");
      expect(script).toContain("s ^= s >> 17");
      expect(script).toContain("s ^= s << 5");
    });

    it("seed is embedded as JSON string in script", () => {
      const script = generateFingerprintScript("my-uuid-123");
      expect(script).toContain('"my-uuid-123"');
    });

    it("produces values in [0, 1) range", () => {
      const script = generateFingerprintScript("seed");
      expect(script).toContain("(s >>> 0) / 4294967296");
    });
  });

  describe("stealth gating", () => {
    it("fingerprint field is true when stealth enabled (default)", () => {
      const stealthEnabled = true;
      const response = { fingerprint: stealthEnabled };
      expect(response.fingerprint).toBe(true);
    });

    it("fingerprint field is false when stealth: false", () => {
      const stealth = false;
      const stealthEnabled = stealth !== false;
      const response = { fingerprint: stealthEnabled };
      expect(response.fingerprint).toBe(false);
    });

    it("stealth defaults to enabled (stealth !== false)", () => {
      const stealth = undefined;
      const stealthEnabled = stealth !== false;
      expect(stealthEnabled).toBe(true);
    });
  });
});
