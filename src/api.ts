import { createServer } from "node:http";
import { SessionManager } from "./session.js";
import { createCdpProxy } from "./cdp-proxy.js";

const PORT = Number(process.env.ANVIL_ENGINE_PORT) || 3000;
const sessionManager = new SessionManager();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const method = req.method || "GET";

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

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
      });

      json(res, 201, {
        id: session.id,
        status: session.status,
        websocketUrl: `ws://localhost:${PORT}/cdp?session=${session.id}`,
        cdpPort: session.browserProcess.cdpPort,
        dimensions: { width: options.dimensions?.width || 1920, height: options.dimensions?.height || 1080 },
        createdAt: new Date(session.createdAt).toISOString(),
      });
      return;
    }

    // GET /v1/sessions — get active session or list
    if (method === "GET" && url.pathname === "/v1/sessions") {
      const active = sessionManager.getActive();
      if (active) {
        json(res, 200, {
          id: active.id,
          status: active.status,
          websocketUrl: `ws://localhost:${PORT}/cdp?session=${active.id}`,
          cdpPort: active.browserProcess.cdpPort,
          createdAt: new Date(active.createdAt).toISOString(),
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

    // POST /v1/sessions/:id/release — destroy session
    const releaseMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/release$/);
    if (method === "POST" && releaseMatch) {
      const session = await sessionManager.destroy(releaseMatch[1]);
      if (session) {
        json(res, 200, { id: session.id, status: "released", duration: Date.now() - session.createdAt });
      } else {
        json(res, 404, { error: "Session not found" });
      }
      return;
    }

    // POST /v1/actions/navigate
    if (method === "POST" && url.pathname === "/v1/actions/navigate") {
      const body = JSON.parse(await readBody(req) || "{}");
      const session = sessionManager.getActive();
      if (!session) { json(res, 400, { error: "No active session" }); return; }

      const puppeteer = await import("puppeteer-core");
      const browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      await page.goto(body.url, { waitUntil: body.waitUntil || "networkidle2" });
      const title = await page.title();
      const currentUrl = page.url();
      browser.disconnect();

      json(res, 200, { url: currentUrl, title });
      return;
    }

    // POST /v1/scrape — navigate and extract content
    if (method === "POST" && url.pathname === "/v1/scrape") {
      const body = JSON.parse(await readBody(req) || "{}");
      const session = sessionManager.getActive();
      if (!session) { json(res, 400, { error: "No active session" }); return; }

      const puppeteer = await import("puppeteer-core");
      const browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();

      await page.goto(body.url, { waitUntil: "networkidle2" });

      if (body.waitForSelector) {
        await page.waitForSelector(body.waitForSelector, { timeout: 10000 });
      }

      const title = await page.title();
      const currentUrl = page.url();
      let content: string;

      const format = body.format || "text";
      if (format === "html") {
        content = await page.content();
      } else {
        content = await page.evaluate(() => document.body.innerText);
      }

      browser.disconnect();
      json(res, 200, { content, title, url: currentUrl });
      return;
    }

    // POST /v1/pdf — generate PDF
    if (method === "POST" && url.pathname === "/v1/pdf") {
      const body = JSON.parse(await readBody(req) || "{}");
      const session = sessionManager.getActive();
      if (!session) { json(res, 400, { error: "No active session" }); return; }

      const puppeteer = await import("puppeteer-core");
      const browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();

      if (body.url) {
        await page.goto(body.url, { waitUntil: "networkidle2" });
      }

      const pdf = await page.pdf({
        format: body.format || "A4",
        landscape: body.landscape || false,
        printBackground: true,
      });
      browser.disconnect();

      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end(pdf);
      return;
    }

    // POST /v1/actions/evaluate — run JS
    if (method === "POST" && url.pathname === "/v1/actions/evaluate") {
      const body = JSON.parse(await readBody(req) || "{}");
      const session = sessionManager.getActive();
      if (!session) { json(res, 400, { error: "No active session" }); return; }

      const puppeteer = await import("puppeteer-core");
      const browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      const result = await page.evaluate(body.script);
      browser.disconnect();

      json(res, 200, result);
      return;
    }

    // GET /v1/screenshot
    if (method === "GET" && url.pathname === "/v1/screenshot") {
      const session = sessionManager.getActive();
      if (!session) { json(res, 400, { error: "No active session" }); return; }

      const fullPage = url.searchParams.get("fullPage") === "true";
      const puppeteer = await import("puppeteer-core");
      const browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      const screenshot = await page.screenshot({ fullPage, encoding: "binary" });
      browser.disconnect();

      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(screenshot);
      return;
    }

    // GET /v1/health
    if (method === "GET" && url.pathname === "/v1/health") {
      json(res, 200, { status: "ok", sessions: sessionManager.size, uptime: process.uptime() });
      return;
    }

    // 404
    json(res, 404, { error: "Not found" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: message });
  }
});

// CDP WebSocket proxy
createCdpProxy(server, sessionManager);

// Graceful shutdown
async function shutdown(signal: string) {
  process.stderr.write(`[anvil-engine] ${signal} — destroying ${sessionManager.size} sessions...\n`);
  await sessionManager.destroyAll();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(PORT, () => {
  process.stderr.write(`[anvil-engine] Running on http://localhost:${PORT}\n`);
  process.stderr.write(`[anvil-engine] CDP proxy on ws://localhost:${PORT}/cdp\n`);
});

// Helpers
function json(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}
