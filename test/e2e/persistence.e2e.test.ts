import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

// Gated real-Chrome E2E for session persistence: prove the full
// serialize -> save (on shutdown) -> load -> restore (on startup) round-trip,
// including cookies, across two engine instances sharing a persist file.

function chromeAvailable(): boolean {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return true;
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].some((p) => existsSync(p));
}

describe.skipIf(!chromeAvailable())("e2e: session persistence round-trip", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    dirs.length = 0;
  });

  it("saves sessions + cookies on shutdown and restores them on startup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "anvil-persist-e2e-"));
    dirs.push(dir);
    const persistPath = join(dir, "sessions.json");
    const env = { ...process.env, ANVIL_API_KEY: "", ANVIL_RATE_LIMIT_RPM: "", ANVIL_PERSIST_PATH: persistPath };

    // --- instance 1: create a session, set a cookie, then shut down (persists) ---
    const app1 = buildApp(loadConfig(env));
    await app1.start();
    const session = await app1.sessionManager.create({ headless: true });
    await app1.actions.navigate(session, { url: "https://example.com/" });
    await app1.actions.evaluate(session, "document.cookie = 'anvil_persist=kept; path=/'");
    await app1.stop(); // writes persistPath

    expect(existsSync(persistPath)).toBe(true);

    // --- instance 2: start with the same persist file -> sessions restored ---
    const app2 = buildApp(loadConfig(env));
    await app2.start();
    try {
      const sessions = app2.sessionManager.list();
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      // The restored session should carry the cookie back to example.com.
      const restored = app2.sessionManager.get(sessions[0].id);
      expect(restored).toBeDefined();
      await app2.actions.navigate(restored!, { url: "https://example.com/" });
      const cookies = await app2.actions.evaluate(restored!, "document.cookie");
      expect(String(cookies)).toContain("anvil_persist=kept");
    } finally {
      await app2.stop();
    }
  }, 90000);
});
