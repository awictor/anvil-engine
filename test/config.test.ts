import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../src/config.js";

const baseEnv = {} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("applies documented defaults with empty env", () => {
    const config = loadConfig(baseEnv);
    expect(config.port).toBe(3000);
    expect(config.host).toBe("0.0.0.0");
    expect(config.apiKey).toBe("");
    expect(config.sessionTimeoutMs).toBe(300000);
    expect(config.rateLimitRpm).toBe(0);
    expect(config.maxSessions).toBe(10);
    expect(config.poolSize).toBe(0);
    expect(config.evaluateTimeoutMs).toBe(30000);
    expect(config.harMaxEntries).toBe(5000);
    expect(config.persistPath).toBe("");
  });

  it("reads ANVIL_PERSIST_PATH when set", () => {
    const config = loadConfig({ ANVIL_PERSIST_PATH: "/var/anvil/sessions.json" } as NodeJS.ProcessEnv);
    expect(config.persistPath).toBe("/var/anvil/sessions.json");
  });

  it("parses valid numeric overrides", () => {
    const config = loadConfig({ ANVIL_ENGINE_PORT: "8080", ANVIL_MAX_SESSIONS: "25" } as NodeJS.ProcessEnv);
    expect(config.port).toBe(8080);
    expect(config.maxSessions).toBe(25);
  });

  it("preserves the Number('0') || default quirk for session timeout", () => {
    // "0" intentionally falls through to the default — pinned legacy behavior.
    const config = loadConfig({ ANVIL_SESSION_TIMEOUT_MS: "0" } as NodeJS.ProcessEnv);
    expect(config.sessionTimeoutMs).toBe(300000);
  });

  it("rejects non-numeric values with a ConfigError naming the variable", () => {
    expect(() => loadConfig({ ANVIL_ENGINE_PORT: "not-a-port" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    try {
      loadConfig({ ANVIL_ENGINE_PORT: "not-a-port" } as NodeJS.ProcessEnv);
    } catch (err) {
      expect((err as ConfigError).problems[0]).toContain("ANVIL_ENGINE_PORT");
    }
  });

  it("rejects out-of-range port", () => {
    expect(() => loadConfig({ ANVIL_ENGINE_PORT: "70000" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it("aggregates multiple problems into one error", () => {
    try {
      loadConfig({ ANVIL_ENGINE_PORT: "abc", ANVIL_MAX_SESSIONS: "xyz" } as NodeJS.ProcessEnv);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ConfigError).problems.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("rejects invalid webhook URLs", () => {
    expect(() => loadConfig({ ANVIL_WEBHOOK_URL: "not a url" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig({ ANVIL_WEBHOOK_URL: "ftp://example.com/hook" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it("accepts valid https webhook URL", () => {
    const config = loadConfig({ ANVIL_WEBHOOK_URL: "https://hooks.example.com/anvil" } as NodeJS.ProcessEnv);
    expect(config.webhookUrl).toBe("https://hooks.example.com/anvil");
  });

  it("caps evaluate timeout at 60s", () => {
    expect(() => loadConfig({ ANVIL_EVALUATE_TIMEOUT_MS: "120000" } as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });
});
