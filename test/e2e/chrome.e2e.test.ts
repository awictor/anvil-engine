import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { buildApp, type App } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

// Full-stack E2E against real Chrome. Skips automatically when Chrome is not
// installed (CI without a browser). Run explicitly with: npx vitest run test/e2e

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

describe.skipIf(!chromeAvailable())("e2e: real Chrome lifecycle", () => {
  let app: App;
  let base: string;
  let sessionId: string;

  beforeAll(async () => {
    const env = {
      ...process.env,
      ANVIL_API_KEY: "",
      ANVIL_RATE_LIMIT_RPM: "",
      ANVIL_EVALUATE_TIMEOUT_MS: "3000",
    };
    app = buildApp(loadConfig(env));
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 30000);

  afterAll(async () => {
    await app.stop();
  }, 30000);

  it("creates a session with real Chrome", async () => {
    const res = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headless: true }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe("live");
    expect(body.fingerprint).toBe(true);
    sessionId = body.id;
  }, 60000);

  it("evaluate returns a real value from the page", async () => {
    const res = await fetch(`${base}/v1/actions/evaluate?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: "2 + 40" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toBe(42);
  }, 30000);

  it("evaluate timeout fires on while(true) and the session survives", async () => {
    const hung = await fetch(`${base}/v1/actions/evaluate?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: "while(true){}" }),
    });
    expect(hung.status).toBe(500);
    const hungBody = await hung.json();
    expect(hungBody.error).toContain("timed out");

    // Session must still answer after the runaway script is terminated
    const alive = await fetch(`${base}/v1/actions/evaluate?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: "'alive'" }),
    });
    expect(alive.status).toBe(200);
    expect(await alive.json()).toBe("alive");
  }, 30000);

  it("screenshot returns real PNG bytes", async () => {
    const res = await fetch(`${base}/v1/screenshot?sessionId=${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30000);

  it("HAR start/stop is idempotent and entries are capped objects", async () => {
    const start = await fetch(`${base}/v1/har/start?sessionId=${sessionId}`, { method: "POST" });
    expect(await start.json()).toEqual({ recording: true });

    // Double-start must not double-register listeners
    const restart = await fetch(`${base}/v1/har/start?sessionId=${sessionId}`, { method: "POST" });
    expect(restart.status).toBe(200);

    const stop = await fetch(`${base}/v1/har/stop?sessionId=${sessionId}`, { method: "POST" });
    const stopBody = await stop.json();
    expect(stopBody.recording).toBe(false);
    expect(typeof stopBody.entries).toBe("number");
  }, 30000);

  it("concurrent evaluate + release does not crash; release drains in-flight work", async () => {
    const evalPromise = fetch(`${base}/v1/actions/evaluate?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: "new Promise(r => setTimeout(() => r('slow'), 500))" }),
    });
    await new Promise((r) => setTimeout(r, 100));
    const releasePromise = fetch(`${base}/v1/sessions/${sessionId}/release`, { method: "POST" });

    const [evalRes, releaseRes] = await Promise.all([evalPromise, releasePromise]);
    // The in-flight evaluate should complete (destroy drains refcount first)
    expect(evalRes.status).toBe(200);
    expect(releaseRes.status).toBe(200);
    const released = await releaseRes.json();
    expect(released.status).toBe("released");

    // Session is gone afterwards
    const gone = await fetch(`${base}/v1/sessions/${sessionId}`);
    expect(gone.status).toBe(404);
  }, 30000);
});
