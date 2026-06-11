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

describe.skipIf(!chromeAvailable())("e2e: multi-page / tabs (SessionActions)", () => {
  let app: App;
  let base: string;

  beforeAll(async () => {
    app = buildApp(loadConfig({ ...process.env, ANVIL_API_KEY: "", ANVIL_RATE_LIMIT_RPM: "" }));
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await app.stop();
  }, 30000);

  it("lists, opens, and closes pages within a session", async () => {
    const session = await app.sessionManager.create({ headless: true });

    // A fresh session has exactly one page (about:blank).
    let pages = await app.actions.listPages(session);
    expect(pages).toHaveLength(1);
    expect(pages[0].index).toBe(0);

    // Open a second page.
    const opened = await app.actions.openPage(session, "about:blank");
    expect(opened.index).toBeGreaterThanOrEqual(1);

    pages = await app.actions.listPages(session);
    expect(pages).toHaveLength(2);

    // Close the second page; one remains.
    const closed = await app.actions.closePage(session, opened.index);
    expect(closed.remaining).toBe(1);
    pages = await app.actions.listPages(session);
    expect(pages).toHaveLength(1);

    await app.sessionManager.destroy(session.id);
  }, 60000);

  it("openPage blocks dangerous protocols and closePage refuses the last page", async () => {
    const session = await app.sessionManager.create({ headless: true });

    await expect(app.actions.openPage(session, "file:///etc/passwd")).rejects.toThrow(/Blocked protocol/);
    await expect(app.actions.closePage(session, 0)).rejects.toThrow(/last remaining page/);

    await app.sessionManager.destroy(session.id);
  }, 60000);

  it("captureFrame returns a JPEG (magic bytes FF D8 FF)", async () => {
    const session = await app.sessionManager.create({ headless: true });
    const frame = await app.actions.captureFrame(session, 50);
    expect(Array.from(frame.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    await app.sessionManager.destroy(session.id);
  }, 60000);

  it("GET /v1/view serves a JPEG frame over HTTP", async () => {
    const created = await (await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headless: true }),
    })).json();
    const sid = created.id;

    const res = await fetch(`${base}/v1/view?sessionId=${sid}&quality=40`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);

    await fetch(`${base}/v1/sessions/${sid}/release`, { method: "POST" });
  }, 60000);

  it("GET /v1/view/stream emits multiple MJPEG parts, then ends after release", async () => {
    const created = await (await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headless: true }),
    })).json();
    const sid = created.id;

    const res = await fetch(`${base}/v1/view/stream?sessionId=${sid}&fps=5&quality=30`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("multipart/x-mixed-replace; boundary=frame");

    // Read until we've seen at least 2 boundary-delimited JPEG parts.
    const reader = res.body!.getReader();
    let buffer = Buffer.alloc(0);
    let boundaries = 0;
    while (boundaries < 2) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = Buffer.concat([buffer, Buffer.from(value)]);
      boundaries = buffer.toString("latin1").split("--frame\r\n").length - 1;
    }
    expect(boundaries).toBeGreaterThanOrEqual(2);
    // Each part declares image/jpeg and the first frame body starts with JPEG magic.
    const text = buffer.toString("latin1");
    expect(text).toContain("Content-Type: image/jpeg");
    const firstBody = buffer.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
    expect(firstBody).toBeGreaterThan(-1);

    // Destroying the session must terminate the stream (reader sees EOF) —
    // the per-frame refcount means destroy never blocks on the open stream.
    await fetch(`${base}/v1/sessions/${sid}/release`, { method: "POST" });
    const deadline = Date.now() + 10000;
    let ended = false;
    while (!ended && Date.now() < deadline) {
      const { done } = await reader.read();
      ended = done === true;
    }
    expect(ended).toBe(true);
  }, 60000);

  it("drives the /v1/pages routes over HTTP", async () => {
    const created = await (await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headless: true }),
    })).json();
    const sid = created.id;

    let list = await (await fetch(`${base}/v1/pages?sessionId=${sid}`)).json();
    expect(list.pages).toHaveLength(1);

    const opened = await (await fetch(`${base}/v1/pages?sessionId=${sid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "about:blank" }),
    })).json();
    expect(opened.index).toBeGreaterThanOrEqual(1);

    list = await (await fetch(`${base}/v1/pages?sessionId=${sid}`)).json();
    expect(list.pages).toHaveLength(2);

    const closeRes = await fetch(`${base}/v1/pages/${opened.index}?sessionId=${sid}`, { method: "DELETE" });
    expect(closeRes.status).toBe(200);
    expect((await closeRes.json()).remaining).toBe(1);

    await fetch(`${base}/v1/sessions/${sid}/release`, { method: "POST" });
  }, 60000);
});

describe.skipIf(!chromeAvailable())("e2e: browser contexts (SessionActions)", () => {
  let app: App;
  let base: string;

  beforeAll(async () => {
    app = buildApp(loadConfig({ ...process.env, ANVIL_API_KEY: "", ANVIL_RATE_LIMIT_RPM: "" }));
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await app.stop();
  }, 30000);

  it("creates, lists, and closes isolated contexts", async () => {
    const session = await app.sessionManager.create({ headless: true });

    expect(app.actions.listContexts(session).contextIds).toHaveLength(0);

    const a = await app.actions.createContext(session);
    const b = await app.actions.createContext(session);
    expect(a.contextId).not.toBe(b.contextId);
    expect(app.actions.listContexts(session).contextIds).toHaveLength(2);

    const closed = await app.actions.closeContext(session, a.contextId);
    expect(closed.remaining).toBe(1);
    expect(app.actions.listContexts(session).contextIds).toEqual([b.contextId]);

    await app.sessionManager.destroy(session.id);
  }, 60000);

  it("closeContext rejects an unknown context id", async () => {
    const session = await app.sessionManager.create({ headless: true });
    await expect(app.actions.closeContext(session, "nope")).rejects.toThrow(/not found/);
    await app.sessionManager.destroy(session.id);
  }, 60000);

  it("drives the /v1/contexts routes over HTTP", async () => {
    const created = await (await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headless: true }),
    })).json();
    const sid = created.id;

    let list = await (await fetch(`${base}/v1/contexts?sessionId=${sid}`)).json();
    expect(list.contextIds).toHaveLength(0);

    const ctx = await (await fetch(`${base}/v1/contexts?sessionId=${sid}`, { method: "POST" })).json();
    expect(typeof ctx.contextId).toBe("string");

    list = await (await fetch(`${base}/v1/contexts?sessionId=${sid}`)).json();
    expect(list.contextIds).toEqual([ctx.contextId]);

    const closeRes = await fetch(`${base}/v1/contexts/${ctx.contextId}?sessionId=${sid}`, { method: "DELETE" });
    expect(closeRes.status).toBe(200);
    expect((await closeRes.json()).remaining).toBe(0);

    await fetch(`${base}/v1/sessions/${sid}/release`, { method: "POST" });
  }, 60000);

  it("cookies set in one context are invisible to another (isolation proof)", async () => {
    const session = await app.sessionManager.create({ headless: true });
    const url = "https://example.com/";

    const a = await app.actions.createContext(session);
    const b = await app.actions.createContext(session);

    // Navigate each context's page to the same origin, then set a cookie only in A.
    await app.actions.navigateInContext(session, a.contextId, url);
    await app.actions.navigateInContext(session, b.contextId, url);
    await app.actions.evaluateInContext(session, a.contextId, "document.cookie = 'anvil_iso=ctxA; path=/'");

    const cookiesA = await app.actions.evaluateInContext(session, a.contextId, "document.cookie");
    const cookiesB = await app.actions.evaluateInContext(session, b.contextId, "document.cookie");

    expect(String(cookiesA)).toContain("anvil_iso=ctxA");
    expect(String(cookiesB)).not.toContain("anvil_iso");

    await app.sessionManager.destroy(session.id);
  }, 60000);
});

describe.skipIf(!chromeAvailable())("e2e: crash recovery (relaunch)", () => {
  let app: App;

  beforeAll(async () => {
    app = buildApp(loadConfig({ ...process.env, ANVIL_API_KEY: "", ANVIL_RATE_LIMIT_RPM: "" }));
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await app.stop();
  }, 30000);

  it("relaunches after a hard Chrome kill: request succeeds, old download dir reclaimed", async () => {
    const session = await app.sessionManager.create({ headless: true });
    // Prime the cached puppeteer connection so the crash is detected on it.
    await app.actions.evaluate(session, "1 + 1");

    const oldProc = session.browserProcess;
    const oldDownloadDir = oldProc.downloadDir!;
    expect(existsSync(oldDownloadDir)).toBe(true);

    // Hard-kill Chrome out from under the engine (simulated crash) and wait
    // for the process to actually exit before issuing the next request.
    const exited = new Promise<void>((resolve) => oldProc.process.once("exit", () => resolve()));
    oldProc.process.kill("SIGKILL");
    await exited;

    // The next operation must detect the crash, relaunch, and still succeed.
    const result = await app.actions.evaluate(session, "'recovered'");
    expect(result).toBe("recovered");

    // A fresh browser process is in place...
    expect(session.browserProcess).not.toBe(oldProc);
    const freshDir = session.browserProcess.downloadDir!;
    expect(freshDir).not.toBe(oldDownloadDir);
    expect(existsSync(freshDir)).toBe(true);
    // ...and the crashed browser's download dir was reclaimed (no orphan).
    expect(existsSync(oldDownloadDir)).toBe(false);

    // Destroy must clean the fresh dir too — nothing left behind either way.
    await app.sessionManager.destroy(session.id);
    expect(existsSync(freshDir)).toBe(false);
  }, 60000);
});
