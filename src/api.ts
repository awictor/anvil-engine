import { createServer } from "node:http";
import { readdirSync, statSync, createReadStream, writeFileSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { SessionManager } from "./session.js";
import { createCdpProxy } from "./cdp-proxy.js";
import { BrowserPool } from "./pool.js";
import { withBrowser } from "./browser-helper.js";
import { generateFingerprintScript } from "./fingerprint.js";
import { fireWebhook } from "./webhooks.js";
import { RateLimiter } from "./rate-limiter.js";

const PORT = Number(process.env.ANVIL_ENGINE_PORT) || 3000;
const API_KEY = process.env.ANVIL_API_KEY || "";
const SESSION_TIMEOUT = Number(process.env.ANVIL_SESSION_TIMEOUT_MS) || 300000;
const RATE_LIMIT_RPM = Number(process.env.ANVIL_RATE_LIMIT_RPM) || 0;
const POOL_SIZE = Number(process.env.ANVIL_POOL_SIZE) || 0;
const pool = POOL_SIZE > 0 ? new BrowserPool(POOL_SIZE) : undefined;
const sessionManager = new SessionManager(pool);
const rateLimiter = RATE_LIMIT_RPM > 0 ? new RateLimiter(RATE_LIMIT_RPM) : null;

const metrics = {
  sessionsCreated: 0,
  sessionsReleased: 0,
  peakConcurrent: 0,
  requestsServed: 0,
  errorsCount: 0,
};

interface HarEntry {
  url: string;
  method: string;
  status: number;
  duration: number;
  responseSize: number;
  timestamp: string;
}
const harStore = new Map<string, HarEntry[]>();

const server = createServer(async (req, res) => {
  const startTime = Date.now();
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const method = req.method || "GET";

  res.on("finish", () => {
    if (method !== "OPTIONS") {
      metrics.requestsServed++;
      if (res.statusCode >= 400) metrics.errorsCount++;
      process.stderr.write(`[anvil-engine] ${method} ${url.pathname} ${res.statusCode} ${Date.now() - startTime}ms\n`);
    }
  });

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Rate limiting (exempt health endpoint)
  if (rateLimiter && url.pathname !== "/v1/health" && url.pathname !== "/v1/metrics") {
    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const { allowed, retryAfterSec } = rateLimiter.consume(clientIp);
    if (!allowed) {
      res.setHeader("Retry-After", String(retryAfterSec));
      json(res, 429, { error: "Rate limit exceeded" });
      return;
    }
  }

  // API key authentication (exempt health + metrics)
  if (API_KEY && url.pathname !== "/v1/health" && url.pathname !== "/v1/metrics") {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${API_KEY}`) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
  }

  // Touch targeted/active session to reset idle timeout
  const resolved = resolveSession(req, url);
  if (resolved.session) sessionManager.touch(resolved.session.id);

  try {
    // POST /v1/sessions — create session
    if (method === "POST" && url.pathname === "/v1/sessions") {
      const body = await readBody(req);
      const options = body ? JSON.parse(body) : {};
      const session = await sessionManager.create({
        headless: options.headless,
        width: options.dimensions?.width,
        height: options.dimensions?.height,
        proxy: options.proxyUrl,
        userDataDir: options.userDataDir,
        stealth: options.stealth,
        userAgent: options.userAgent,
      });

      // Apply user-agent, viewport, and fingerprint on initial page
      const width = options.dimensions?.width || 1920;
      const height = options.dimensions?.height || 1080;
      const stealthEnabled = options.stealth !== false;
      await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        if (options.userAgent) {
          await page.setUserAgent(options.userAgent);
        }
        await page.setViewport({ width, height });
        if (stealthEnabled) {
          await page.evaluateOnNewDocument(generateFingerprintScript(session.id));
        }
      });

      json(res, 201, {
        id: session.id,
        status: session.status,
        websocketUrl: `ws://localhost:${PORT}/cdp?session=${session.id}`,
        cdpPort: session.browserProcess.cdpPort,
        dimensions: { width: options.dimensions?.width || 1920, height: options.dimensions?.height || 1080 },
        userAgent: session.options.userAgent || null,
        fingerprint: stealthEnabled,
        createdAt: new Date(session.createdAt).toISOString(),
      });
      fireWebhook("session.created", session.id);
      metrics.sessionsCreated++;
      metrics.peakConcurrent = Math.max(metrics.peakConcurrent, sessionManager.size);
      return;
    }

    // GET /v1/sessions — get active session or list
    if (method === "GET" && url.pathname === "/v1/sessions") {
      const active = sessionManager.getActive();
      if (active) {
        const idleMs = Date.now() - active.lastActivityAt;
        json(res, 200, {
          id: active.id,
          status: active.status,
          websocketUrl: `ws://localhost:${PORT}/cdp?session=${active.id}`,
          cdpPort: active.browserProcess.cdpPort,
          createdAt: new Date(active.createdAt).toISOString(),
          timeoutMs: SESSION_TIMEOUT,
          idleMs,
          expiresAt: SESSION_TIMEOUT > 0 ? new Date(active.lastActivityAt + SESSION_TIMEOUT).toISOString() : null,
        });
      } else {
        json(res, 200, { id: null, status: "idle" });
      }
      return;
    }

    // GET /v1/sessions/list — list all sessions
    if (method === "GET" && url.pathname === "/v1/sessions/list") {
      json(res, 200, { sessions: sessionManager.list(), count: sessionManager.size });
      return;
    }

    // GET /v1/sessions/:id — get specific session details
    const sessionDetailMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
    if (method === "GET" && sessionDetailMatch && sessionDetailMatch[1] !== "list") {
      const session = sessionManager.get(sessionDetailMatch[1]);
      if (!session) { json(res, 404, { error: "Session not found" }); return; }
      const idleMs = Date.now() - session.lastActivityAt;
      json(res, 200, {
        id: session.id,
        status: session.status,
        websocketUrl: `ws://localhost:${PORT}/cdp?session=${session.id}`,
        cdpPort: session.browserProcess.cdpPort,
        dimensions: { width: session.options.width || 1920, height: session.options.height || 1080 },
        userAgent: session.options.userAgent || null,
        createdAt: new Date(session.createdAt).toISOString(),
        timeoutMs: SESSION_TIMEOUT,
        idleMs,
        expiresAt: SESSION_TIMEOUT > 0 ? new Date(session.lastActivityAt + SESSION_TIMEOUT).toISOString() : null,
      });
      return;
    }

    // POST /v1/sessions/:id/release — destroy session
    const releaseMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/release$/);
    if (method === "POST" && releaseMatch) {
      const session = await sessionManager.destroy(releaseMatch[1]);
      if (session) {
        json(res, 200, { id: session.id, status: "released", duration: Date.now() - session.createdAt });
        fireWebhook("session.released", session.id);
        metrics.sessionsReleased++;
      } else {
        json(res, 404, { error: "Session not found" });
      }
      return;
    }

    // POST /v1/actions/navigate
    if (method === "POST" && url.pathname === "/v1/actions/navigate") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.url || typeof body.url !== "string") {
        json(res, 400, { error: "body.url must be a non-empty string" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const result = await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        if (session.browserProcess.proxyCredentials) {
          await page.authenticate(session.browserProcess.proxyCredentials);
        }
        await page.goto(body.url, { waitUntil: body.waitUntil || "networkidle2" });
        return { url: page.url(), title: await page.title() };
      });

      json(res, 200, result);
      return;
    }

    // POST /v1/scrape — navigate and extract content
    if (method === "POST" && url.pathname === "/v1/scrape") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.url || typeof body.url !== "string") {
        json(res, 400, { error: "body.url must be a non-empty string" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const result = await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        if (session.browserProcess.proxyCredentials) {
          await page.authenticate(session.browserProcess.proxyCredentials);
        }
        await page.goto(body.url, { waitUntil: "networkidle2" });
        if (body.waitForSelector) {
          await page.waitForSelector(body.waitForSelector, { timeout: 10000 });
        }
        const format = body.format || "text";
        const content = format === "html"
          ? await page.content()
          : await page.evaluate(() => document.body.innerText);
        return { content, title: await page.title(), url: page.url() };
      });

      json(res, 200, result);
      return;
    }

    // POST /v1/pdf — generate PDF
    if (method === "POST" && url.pathname === "/v1/pdf") {
      const body = JSON.parse(await readBody(req) || "{}");
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const pdf = await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        if (session.browserProcess.proxyCredentials) {
          await page.authenticate(session.browserProcess.proxyCredentials);
        }
        if (body.url) {
          await page.goto(body.url, { waitUntil: "networkidle2" });
        }
        return page.pdf({
          format: body.format || "A4",
          landscape: body.landscape || false,
          printBackground: true,
        });
      });
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end(pdf);
      return;
    }

    // GET /v1/cookies — extract all cookies from active session
    if (method === "GET" && url.pathname === "/v1/cookies") {
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const cookies = await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        return page.cookies();
      });
      json(res, 200, { cookies });
      return;
    }

    // POST /v1/cookies — inject cookies into active session
    if (method === "POST" && url.pathname === "/v1/cookies") {
      const body = JSON.parse(await readBody(req) || "{}");
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      if (!Array.isArray(body.cookies)) {
        json(res, 400, { error: "body.cookies must be an array" });
        return;
      }

      await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        await page.setCookie(...body.cookies);
      });
      json(res, 200, { injected: body.cookies.length });
      return;
    }

    // POST /v1/har/start — begin network recording
    if (method === "POST" && url.pathname === "/v1/har/start") {
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      harStore.set(session.id, []);
      const puppeteer = await import("puppeteer-core");
      const browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();

      page.on("response", async (response) => {
        const entries = harStore.get(session.id);
        if (!entries) return;
        try {
          const req = response.request();
          const timing = response.timing();
          const buffer = await response.buffer().catch(() => Buffer.alloc(0));
          entries.push({
            url: req.url(),
            method: req.method(),
            status: response.status(),
            duration: timing ? Math.round(timing.receiveHeadersEnd) : 0,
            responseSize: buffer.length,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Skip failed entries
        }
      });

      browser.disconnect();
      json(res, 200, { recording: true });
      return;
    }

    // POST /v1/har/stop — stop network recording
    if (method === "POST" && url.pathname === "/v1/har/stop") {
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const entries = harStore.get(session.id) || [];
      json(res, 200, { recording: false, entries: entries.length });
      return;
    }

    // GET /v1/har — retrieve captured entries
    if (method === "GET" && url.pathname === "/v1/har") {
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const entries = harStore.get(session.id) || [];
      json(res, 200, { entries });
      return;
    }

    // POST /v1/intercept — enable/disable request interception
    if (method === "POST" && url.pathname === "/v1/intercept") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (typeof body.enabled !== "boolean") {
        json(res, 400, { error: "body.enabled must be a boolean" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const puppeteer = await import("puppeteer-core");
      const browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();

      if (body.enabled) {
        const blockPatterns: string[] = body.blockPatterns || [];
        await page.setRequestInterception(true);
        page.on("request", (req) => {
          if (blockPatterns.some((p) => req.url().includes(p))) {
            req.abort().catch(() => {});
          } else {
            req.continue().catch(() => {});
          }
        });
        browser.disconnect();
        json(res, 200, { enabled: true, blocking: blockPatterns.length });
      } else {
        await page.setRequestInterception(false);
        browser.disconnect();
        json(res, 200, { enabled: false, blocking: 0 });
      }
      return;
    }

    // POST /v1/actions/click
    if (method === "POST" && url.pathname === "/v1/actions/click") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.selector || typeof body.selector !== "string") {
        json(res, 400, { error: "body.selector must be a non-empty string" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        await page.click(body.selector, {
          button: body.button || "left",
          clickCount: body.clickCount || 1,
        });
      });
      json(res, 200, { success: true, selector: body.selector });
      return;
    }

    // POST /v1/actions/type
    if (method === "POST" && url.pathname === "/v1/actions/type") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.selector || typeof body.selector !== "string") {
        json(res, 400, { error: "body.selector must be a non-empty string" });
        return;
      }
      if (!body.text || typeof body.text !== "string") {
        json(res, 400, { error: "body.text must be a non-empty string" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        await page.type(body.selector, body.text, { delay: body.delay || 0 });
      });
      json(res, 200, { success: true, selector: body.selector });
      return;
    }

    // POST /v1/actions/select
    if (method === "POST" && url.pathname === "/v1/actions/select") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.selector || typeof body.selector !== "string") {
        json(res, 400, { error: "body.selector must be a non-empty string" });
        return;
      }
      if (!Array.isArray(body.values)) {
        json(res, 400, { error: "body.values must be an array of strings" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const selected = await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        return page.select(body.selector, ...body.values);
      });
      json(res, 200, { success: true, selector: body.selector, selected });
      return;
    }

    // POST /v1/actions/hover
    if (method === "POST" && url.pathname === "/v1/actions/hover") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.selector || typeof body.selector !== "string") {
        json(res, 400, { error: "body.selector must be a non-empty string" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        await page.hover(body.selector);
      });
      json(res, 200, { success: true, selector: body.selector });
      return;
    }

    // POST /v1/actions/wait
    if (method === "POST" && url.pathname === "/v1/actions/wait") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.selector || typeof body.selector !== "string") {
        json(res, 400, { error: "body.selector must be a non-empty string" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        await page.waitForSelector(body.selector, { timeout: body.timeout || 10000 });
      });
      json(res, 200, { success: true, selector: body.selector });
      return;
    }

    // POST /v1/actions/upload — upload file to input element
    if (method === "POST" && url.pathname === "/v1/actions/upload") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.selector || typeof body.selector !== "string") {
        json(res, 400, { error: "body.selector must be a non-empty string" });
        return;
      }
      if (!body.filename || typeof body.filename !== "string") {
        json(res, 400, { error: "body.filename must be a non-empty string" });
        return;
      }
      if (body.filename.includes("..") || body.filename.includes("/") || body.filename.includes("\\") || /[\r\n\0]/.test(body.filename)) {
        json(res, 400, { error: "Invalid filename" });
        return;
      }
      if (!body.data || typeof body.data !== "string") {
        json(res, 400, { error: "body.data must be a non-empty base64 string" });
        return;
      }
      const decoded = Buffer.from(body.data, "base64");
      if (decoded.length > 10_485_760) {
        json(res, 400, { error: "File data exceeds 10MB limit" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const dir = session.browserProcess.downloadDir;
      if (!dir) { json(res, 500, { error: "No temp directory available" }); return; }

      const tempPath = join(dir, basename(body.filename));
      writeFileSync(tempPath, decoded);
      try {
        await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
          const input = await page.$(body.selector) as import("puppeteer-core").ElementHandle<HTMLInputElement> | null;
          if (!input) throw new Error(`Element not found: ${body.selector}`);
          await input.uploadFile(tempPath);
        });
        json(res, 200, { success: true, selector: body.selector, filename: body.filename });
      } finally {
        try { unlinkSync(tempPath); } catch {}
      }
      return;
    }

    // POST /v1/actions/evaluate — run JS
    if (method === "POST" && url.pathname === "/v1/actions/evaluate") {
      const body = JSON.parse(await readBody(req) || "{}");
      if (!body.script || typeof body.script !== "string") {
        json(res, 400, { error: "body.script must be a non-empty string" });
        return;
      }
      if (body.script.length > 100_000) {
        json(res, 400, { error: "body.script exceeds 100KB limit" });
        return;
      }
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const result = await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        return page.evaluate(body.script);
      });
      json(res, 200, result);
      return;
    }

    // GET /v1/screenshot
    if (method === "GET" && url.pathname === "/v1/screenshot") {
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }

      const fullPage = url.searchParams.get("fullPage") === "true";
      const screenshot = await withBrowser(session.browserProcess.wsEndpoint, async (page) => {
        return page.screenshot({ fullPage, encoding: "binary" });
      });
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(screenshot);
      return;
    }

    // GET /v1/downloads — list files in session's download dir
    if (method === "GET" && url.pathname === "/v1/downloads") {
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }
      const dir = session.browserProcess.downloadDir;
      if (!dir) { json(res, 200, { files: [] }); return; }

      try {
        const entries = readdirSync(dir);
        const files = entries.map((name) => {
          const st = statSync(join(dir, name));
          return { name, size: st.size, createdAt: st.birthtime.toISOString() };
        });
        json(res, 200, { files });
      } catch {
        json(res, 200, { files: [] });
      }
      return;
    }

    // GET /v1/downloads/:filename — retrieve a downloaded file
    const downloadMatch = url.pathname.match(/^\/v1\/downloads\/(.+)$/);
    if (method === "GET" && downloadMatch) {
      const { session, error: sessionError } = resolveSession(req, url);
      if (sessionError) { json(res, sessionError.status, sessionError.body); return; }
      const dir = session.browserProcess.downloadDir;
      if (!dir) { json(res, 404, { error: "No download directory" }); return; }

      const filename = decodeURIComponent(downloadMatch[1]);
      // Prevent path traversal and header injection
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\") || /[\r\n\0]/.test(filename)) {
        json(res, 400, { error: "Invalid filename" });
        return;
      }
      const filePath = join(dir, basename(filename));
      try {
        const st = statSync(filePath);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": st.size.toString(),
        });
        createReadStream(filePath).pipe(res);
      } catch {
        json(res, 404, { error: "File not found" });
      }
      return;
    }

    // GET /v1/health
    if (method === "GET" && url.pathname === "/v1/health") {
      json(res, 200, { status: "ok", sessions: sessionManager.size, uptime: process.uptime(), sessionTimeoutMs: SESSION_TIMEOUT, multiSession: true });
      return;
    }

    // GET /v1/metrics
    if (method === "GET" && url.pathname === "/v1/metrics") {
      json(res, 200, { ...metrics, activeSessions: sessionManager.size, uptime: process.uptime() });
      return;
    }

    // 404
    json(res, 404, { error: "Not found" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("too large") ? 413
      : message.includes("not found") || message.includes("Not found") ? 404
      : 500;
    json(res, status, { error: message });
  }
});

// CDP WebSocket proxy
createCdpProxy(server, sessionManager);

// Graceful shutdown
async function shutdown(signal: string) {
  process.stderr.write(`[anvil-engine] ${signal} — destroying ${sessionManager.size} sessions...\n`);
  sessionManager.stopCleanup();
  if (rateLimiter) rateLimiter.stopCleanup();
  await sessionManager.destroyAll();
  if (pool) await pool.shutdown();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Start server (init pool first if configured)
(async () => {
  if (pool) {
    process.stderr.write(`[anvil-engine] Pre-warming ${POOL_SIZE} browser instances...\n`);
    await pool.init();
    process.stderr.write(`[anvil-engine] Pool ready: ${pool.available} warm instances\n`);
  }
  sessionManager.startCleanup(SESSION_TIMEOUT);
  if (rateLimiter) rateLimiter.startCleanup();
  server.listen(PORT, () => {
    process.stderr.write(`[anvil-engine] Running on http://localhost:${PORT}\n`);
    process.stderr.write(`[anvil-engine] CDP proxy on ws://localhost:${PORT}/cdp\n`);
    process.stderr.write(`[anvil-engine] Auth: ${API_KEY ? "API key enabled" : "disabled (dev mode)"}\n`);
    process.stderr.write(`[anvil-engine] Session timeout: ${SESSION_TIMEOUT > 0 ? `${SESSION_TIMEOUT}ms` : "disabled"}\n`);
  });
})();

// Helpers
type ResolveResult = { session: import("./session.js").Session; error?: never } | { session?: never; error: { status: number; body: { error: string } } };

function resolveSession(req: import("node:http").IncomingMessage, url: URL): ResolveResult {
  const explicitId = (req.headers["x-session-id"] as string) || url.searchParams.get("sessionId") || "";
  if (explicitId) {
    const session = sessionManager.get(explicitId);
    if (!session) return { error: { status: 404, body: { error: "Session not found" } } };
    return { session };
  }
  const session = sessionManager.getActive();
  if (!session) return { error: { status: 400, body: { error: "No active session" } } };
  return { session };
}

function json(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
