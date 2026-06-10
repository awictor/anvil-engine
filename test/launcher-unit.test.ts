import { describe, it, expect, afterEach } from "vitest";
import { validateProxyUrl, findChromePath, killBrowser, getNextCdpPort } from "../src/launcher.js";

const savedAllow = process.env.ANVIL_ALLOW_PRIVATE_PROXY;
const savedChrome = process.env.CHROME_PATH;

afterEach(() => {
  if (savedAllow === undefined) delete process.env.ANVIL_ALLOW_PRIVATE_PROXY;
  else process.env.ANVIL_ALLOW_PRIVATE_PROXY = savedAllow;
  if (savedChrome === undefined) delete process.env.CHROME_PATH;
  else process.env.CHROME_PATH = savedChrome;
});

describe("validateProxyUrl (SSRF protection)", () => {
  it("rejects localhost", () => {
    expect(() => validateProxyUrl("http://localhost:8080")).toThrow(/private or internal/);
  });

  it("rejects 127.0.0.1", () => {
    expect(() => validateProxyUrl("http://127.0.0.1:8080")).toThrow(/private or internal/);
  });

  it("rejects 10.x RFC1918", () => {
    expect(() => validateProxyUrl("http://10.0.0.5:3128")).toThrow(/private or internal/);
  });

  it("rejects 172.16-31.x RFC1918", () => {
    expect(() => validateProxyUrl("http://172.16.0.1:3128")).toThrow(/private or internal/);
    expect(() => validateProxyUrl("http://172.31.255.1:3128")).toThrow(/private or internal/);
  });

  it("allows 172.32.x (outside RFC1918 range)", () => {
    expect(() => validateProxyUrl("http://172.32.0.1:3128")).not.toThrow();
  });

  it("rejects 192.168.x", () => {
    expect(() => validateProxyUrl("http://192.168.1.1:8080")).toThrow(/private or internal/);
  });

  it("rejects link-local 169.254.x (cloud metadata)", () => {
    expect(() => validateProxyUrl("http://169.254.169.254:80")).toThrow(/private or internal/);
  });

  it("rejects bare host:port pointing at private hosts", () => {
    expect(() => validateProxyUrl("127.0.0.1:8080")).toThrow(/private or internal/);
    expect(() => validateProxyUrl("localhost:8080")).toThrow(/private or internal/);
  });

  it("allows public proxies as URL and bare host:port", () => {
    expect(() => validateProxyUrl("http://proxy.example.com:8080")).not.toThrow();
    expect(() => validateProxyUrl("proxy.example.com:8080")).not.toThrow();
  });

  it("allows credentialed public proxy URLs", () => {
    expect(() => validateProxyUrl("http://user:pass@proxy.example.com:8080")).not.toThrow();
  });

  it("ANVIL_ALLOW_PRIVATE_PROXY=true overrides all checks", () => {
    process.env.ANVIL_ALLOW_PRIVATE_PROXY = "true";
    expect(() => validateProxyUrl("http://127.0.0.1:8080")).not.toThrow();
    expect(() => validateProxyUrl("http://169.254.169.254")).not.toThrow();
  });
});

describe("findChromePath", () => {
  it("CHROME_PATH env var takes precedence without existence check", () => {
    process.env.CHROME_PATH = "/custom/chrome/binary";
    expect(findChromePath()).toBe("/custom/chrome/binary");
  });

  it("finds a real Chrome on this machine or throws a helpful error", () => {
    delete process.env.CHROME_PATH;
    try {
      const path = findChromePath();
      expect(path.toLowerCase()).toMatch(/chrome|chromium/);
    } catch (err) {
      expect((err as Error).message).toContain("Set CHROME_PATH");
    }
  });
});

describe("killBrowser", () => {
  it("returns a promise and resolves for an already-dead process", async () => {
    const fake = {
      pid: 99999,
      cdpPort: 9999,
      wsEndpoint: "ws://127.0.0.1:9999",
      process: {
        exitCode: 0,
        signalCode: null,
        killed: true,
        kill: () => true,
        once: () => {},
      },
    };
    const result = killBrowser(fake as never);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });
});

describe("getNextCdpPort", () => {
  it("returns sequential ports for normal in-range calls", () => {
    const p1 = getNextCdpPort();
    const p2 = getNextCdpPort();
    expect(p2).toBe(p1 + 1);
  });

  it("stays within the valid TCP range and wraps instead of climbing past the ceiling", () => {
    // Call past the full base..ceiling span (~56k) so the allocator must wrap.
    // Keep the hot loop assertion-free; check aggregates after.
    let min = Infinity;
    let max = -Infinity;
    let sawBase = false;
    let allIntegers = true;
    for (let i = 0; i < 130_000; i++) {
      const port = getNextCdpPort();
      if (!Number.isInteger(port)) allIntegers = false;
      if (port < min) min = port;
      if (port > max) max = port;
      if (port === 9222) sawBase = true;
    }
    expect(allIntegers).toBe(true);
    expect(min).toBe(9222);          // never below base
    expect(max).toBeLessThanOrEqual(65000); // never an invalid TCP port
    expect(sawBase).toBe(true);      // wrapped back to base within the run
  });
});
