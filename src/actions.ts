import type { Browser, BrowserContext, Page, HTTPResponse, HTTPRequest, Cookie, CookieParam } from "puppeteer-core";
import { randomUUID } from "node:crypto";
import { launchBrowser, killBrowser } from "./launcher.js";
import { type Session, type SessionManager } from "./session.js";
import { isCrashError } from "./browser-helper.js";
import { createLogger } from "./logger.js";

const logger = createLogger("actions");

export interface HarEntry {
  url: string;
  method: string;
  status: number;
  duration: number;
  responseSize: number;
  timestamp: string;
}

export interface ActionEntry {
  action: string;
  params: Record<string, unknown>;
  timestamp: string;
  durationMs: number;
}

export interface ActionsConfig {
  evaluateTimeoutMs: number;
  harMaxEntries: number;
}

/**
 * Browser business logic, decoupled from the HTTP layer. Owns one cached
 * puppeteer connection per session (invalidated on crash/destroy), the
 * HAR/recording stores, and their page listeners — all released via
 * SessionManager.onDestroy so nothing leaks when a session dies.
 */
export class SessionActions {
  private connections = new Map<string, Browser>();
  private harStore = new Map<string, HarEntry[]>();
  private harListeners = new Map<string, { page: Page; listener: (response: HTTPResponse) => void }>();
  private interceptListeners = new Map<string, { page: Page; listener: (request: HTTPRequest) => void }>();
  private recordingStore = new Map<string, ActionEntry[]>();
  // Per-session isolated browser contexts, keyed by a generated contextId.
  private contexts = new Map<string, Map<string, BrowserContext>>();

  constructor(
    private sessionManager: SessionManager,
    private config: ActionsConfig = { evaluateTimeoutMs: 30000, harMaxEntries: 5000 },
  ) {
    sessionManager.onDestroy = (session) => this.releaseSessionResources(session.id);
  }

  // --- connection lifecycle ---

  private async getBrowser(session: Session): Promise<Browser> {
    const cached = this.connections.get(session.id);
    if (cached && cached.connected) return cached;
    if (cached) this.connections.delete(session.id);

    const puppeteer = await import("puppeteer-core");
    let browser: Browser;
    try {
      browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Browser connection failed (session may have crashed): ${msg}`);
    }
    this.connections.set(session.id, browser);
    return browser;
  }

  private invalidate(sessionId: string): void {
    const browser = this.connections.get(sessionId);
    if (browser) {
      this.connections.delete(sessionId);
      try { void browser.disconnect(); } catch {}
    }
    // Listeners died with the connection; drop the trackers (collected data stays).
    this.harListeners.delete(sessionId);
    this.interceptListeners.delete(sessionId);
  }

  private async relaunch(session: Session): Promise<void> {
    logger.warn("Browser crashed, relaunching session", { sessionId: session.id });
    const old = session.browserProcess;
    void killBrowser(old);
    const fresh = await launchBrowser(session.options);
    fresh.downloadDir = old.downloadDir;
    session.browserProcess = fresh;
    this.invalidate(session.id);
  }

  /**
   * Runs a browser operation against the session with in-flight tracking
   * (blocks the cleanup race) and a single relaunch retry on crash.
   */
  private async run<T>(session: Session, fn: (page: Page, browser: Browser) => Promise<T>): Promise<T> {
    if (!this.sessionManager.beginRequest(session.id)) {
      throw new Error("Session not found");
    }
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const browser = await this.getBrowser(session);
          const pages = await browser.pages();
          const page = pages[0] || (await browser.newPage());
          return await fn(page, browser);
        } catch (err) {
          this.invalidate(session.id);
          if (attempt === 0 && isCrashError(err)) {
            await this.relaunch(session);
            continue;
          }
          throw err;
        }
      }
    } finally {
      this.sessionManager.endRequest(session.id);
    }
  }

  private async authenticated(session: Session, page: Page): Promise<void> {
    if (session.browserProcess.proxyCredentials) {
      await page.authenticate(session.browserProcess.proxyCredentials);
    }
  }

  // --- session setup ---

  async applySessionDefaults(
    session: Session,
    opts: { userAgent?: string; width: number; height: number; fingerprintScript?: string },
  ): Promise<void> {
    await this.run(session, async (page) => {
      if (opts.userAgent) await page.setUserAgent(opts.userAgent);
      await page.setViewport({ width: opts.width, height: opts.height });
      if (opts.fingerprintScript) await page.evaluateOnNewDocument(opts.fingerprintScript);
    });
  }

  // --- navigation & content ---

  async navigate(session: Session, params: { url: string; waitUntil?: string; timeout?: number }): Promise<{ url: string; title: string }> {
    return this.run(session, async (page) => {
      await this.authenticated(session, page);
      await page.goto(params.url, {
        waitUntil: (params.waitUntil as "networkidle2") || "networkidle2",
        timeout: Math.min(params.timeout || 30000, 60000),
      });
      return { url: page.url(), title: await page.title() };
    });
  }

  async scrape(session: Session, params: { url: string; waitForSelector?: string; format?: string }): Promise<{ content: string; title: string; url: string }> {
    return this.run(session, async (page) => {
      await this.authenticated(session, page);
      await page.goto(params.url, { waitUntil: "networkidle2", timeout: 60000 });
      if (params.waitForSelector) {
        await page.waitForSelector(params.waitForSelector, { timeout: 10000 });
      }
      const content = params.format === "html"
        ? await page.content()
        : await page.evaluate(() => document.body?.innerText || "");
      return { content, title: await page.title(), url: page.url() };
    });
  }

  async pdf(session: Session, params: { url?: string; format?: string; landscape?: boolean }): Promise<Uint8Array> {
    return this.run(session, async (page) => {
      await this.authenticated(session, page);
      if (params.url) {
        await page.goto(params.url, { waitUntil: "networkidle2", timeout: 60000 });
      }
      return page.pdf({
        format: (params.format as "a4") || "A4",
        landscape: params.landscape || false,
        printBackground: true,
      });
    });
  }

  async screenshot(session: Session, fullPage: boolean): Promise<Uint8Array> {
    return this.run(session, (page) => page.screenshot({ fullPage, encoding: "binary" }));
  }

  async getCookies(session: Session): Promise<Cookie[]> {
    return this.run(session, (page) => page.cookies());
  }

  async setCookies(session: Session, cookies: CookieParam[]): Promise<number> {
    await this.run(session, (page) => page.setCookie(...cookies));
    return cookies.length;
  }

  // --- multi-page / tabs ---

  async listPages(session: Session): Promise<Array<{ index: number; url: string; title: string }>> {
    return this.run(session, async (_page, browser) => {
      const pages = await browser.pages();
      return Promise.all(
        pages.map(async (p, index) => ({ index, url: p.url(), title: await p.title().catch(() => "") })),
      );
    });
  }

  async openPage(session: Session, url?: string): Promise<{ index: number; url: string }> {
    if (url && /^(file|javascript|data):/i.test(url)) {
      throw new Error("Blocked protocol: only http/https allowed");
    }
    return this.run(session, async (_page, browser) => {
      const newPage = await browser.newPage();
      if (url) {
        await newPage.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      }
      const pages = await browser.pages();
      return { index: pages.indexOf(newPage), url: newPage.url() };
    });
  }

  async closePage(session: Session, index: number): Promise<{ closed: number; remaining: number }> {
    return this.run(session, async (_page, browser) => {
      const pages = await browser.pages();
      if (index < 0 || index >= pages.length) throw new Error(`Page index ${index} out of range`);
      if (pages.length === 1) throw new Error("Cannot close the last remaining page");
      await pages[index].close();
      return { closed: index, remaining: pages.length - 1 };
    });
  }

  // --- isolated browser contexts ---

  async createContext(session: Session): Promise<{ contextId: string }> {
    return this.run(session, async (_page, browser) => {
      const context = await browser.createBrowserContext();
      const contextId = randomUUID();
      let byId = this.contexts.get(session.id);
      if (!byId) {
        byId = new Map();
        this.contexts.set(session.id, byId);
      }
      byId.set(contextId, context);
      return { contextId };
    });
  }

  listContexts(session: Session): { contextIds: string[] } {
    const byId = this.contexts.get(session.id);
    return { contextIds: byId ? [...byId.keys()] : [] };
  }

  async closeContext(session: Session, contextId: string): Promise<{ closed: string; remaining: number }> {
    const byId = this.contexts.get(session.id);
    const context = byId?.get(contextId);
    if (!byId || !context) throw new Error(`Context ${contextId} not found`);
    await context.close();
    byId.delete(contextId);
    return { closed: contextId, remaining: byId.size };
  }

  // --- element actions ---

  async click(session: Session, params: { selector: string; button?: string; clickCount?: number }): Promise<void> {
    await this.run(session, (page) =>
      page.click(params.selector, {
        button: (params.button as "left") || "left",
        clickCount: params.clickCount || 1,
      }),
    );
  }

  async type(session: Session, params: { selector: string; text: string; delay?: number }): Promise<void> {
    await this.run(session, (page) =>
      page.type(params.selector, params.text, { delay: Math.min(params.delay || 0, 500) }),
    );
  }

  async select(session: Session, params: { selector: string; values: string[] }): Promise<string[]> {
    return this.run(session, (page) => page.select(params.selector, ...params.values));
  }

  async hover(session: Session, selector: string): Promise<void> {
    await this.run(session, (page) => page.hover(selector));
  }

  async wait(session: Session, params: { selector: string; timeout?: number }): Promise<void> {
    await this.run(session, async (page) => {
      await page.waitForSelector(params.selector, { timeout: Math.min(params.timeout || 10000, 60000) });
    });
  }

  async upload(session: Session, params: { selector: string; tempPath: string }): Promise<void> {
    await this.run(session, async (page) => {
      const input = (await page.$(params.selector)) as import("puppeteer-core").ElementHandle<HTMLInputElement> | null;
      if (!input) throw new Error(`Element not found: ${params.selector}`);
      await input.uploadFile(params.tempPath);
    });
  }

  async evaluate(session: Session, script: string): Promise<unknown> {
    return this.run(session, async (page) => {
      // A CDP session lets us Runtime.terminateExecution on timeout — without
      // it a while(true) script wedges the page thread forever even though
      // the HTTP caller got a timeout error.
      const client = await page.createCDPSession();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            client.send("Runtime.terminateExecution").catch(() => {});
            reject(new Error(`Script execution timed out after ${this.config.evaluateTimeoutMs}ms`));
          }, this.config.evaluateTimeoutMs);
        });
        try {
          return await Promise.race([page.evaluate(script), timeout]);
        } catch (err) {
          if (timedOut) throw new Error(`Script execution timed out after ${this.config.evaluateTimeoutMs}ms`);
          throw err;
        }
      } finally {
        if (timer) clearTimeout(timer);
        client.detach().catch(() => {});
      }
    });
  }

  // --- HAR recording ---

  async startHar(session: Session): Promise<void> {
    this.harStore.set(session.id, []);
    await this.run(session, async (page) => {
      // Idempotent: drop any previous listener before attaching a new one.
      this.removeHarListener(session.id);
      const listener = (response: HTTPResponse) => {
        void (async () => {
          const entries = this.harStore.get(session.id);
          if (!entries || entries.length >= this.config.harMaxEntries) return;
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
        })();
      };
      page.on("response", listener);
      this.harListeners.set(session.id, { page, listener });
    });
  }

  stopHar(session: Session): HarEntry[] {
    this.removeHarListener(session.id);
    return this.harStore.get(session.id) || [];
  }

  getHar(session: Session): HarEntry[] {
    return this.harStore.get(session.id) || [];
  }

  private removeHarListener(sessionId: string): void {
    const tracked = this.harListeners.get(sessionId);
    if (tracked) {
      try { tracked.page.off("response", tracked.listener); } catch {}
      this.harListeners.delete(sessionId);
    }
  }

  // --- request interception ---

  async setIntercept(session: Session, enabled: boolean, blockPatterns: string[]): Promise<void> {
    await this.run(session, async (page) => {
      const tracked = this.interceptListeners.get(session.id);
      if (tracked) {
        try { tracked.page.off("request", tracked.listener); } catch {}
        this.interceptListeners.delete(session.id);
      }
      if (enabled) {
        await page.setRequestInterception(true);
        const listener = (req: HTTPRequest) => {
          if (blockPatterns.some((p) => req.url().includes(p))) {
            req.abort().catch(() => {});
          } else {
            req.continue().catch(() => {});
          }
        };
        page.on("request", listener);
        this.interceptListeners.set(session.id, { page, listener });
      } else {
        await page.setRequestInterception(false);
      }
    });
  }

  // --- action recording ---

  startRecording(session: Session): void {
    this.recordingStore.set(session.id, []);
  }

  stopRecording(session: Session): ActionEntry[] {
    const entries = this.recordingStore.get(session.id) || [];
    this.recordingStore.delete(session.id);
    return entries;
  }

  getRecording(session: Session): { recording: boolean; actions: ActionEntry[] } {
    return {
      recording: this.recordingStore.has(session.id),
      actions: this.recordingStore.get(session.id) || [],
    };
  }

  recordAction(sessionId: string, action: string, params: Record<string, unknown>, durationMs: number): void {
    const entries = this.recordingStore.get(sessionId);
    if (!entries) return;
    entries.push({ action, params, timestamp: new Date().toISOString(), durationMs });
  }

  // --- cleanup (called from SessionManager.onDestroy) ---

  releaseSessionResources(sessionId: string): void {
    this.removeHarListener(sessionId);
    const intercept = this.interceptListeners.get(sessionId);
    if (intercept) {
      try { intercept.page.off("request", intercept.listener); } catch {}
      this.interceptListeners.delete(sessionId);
    }
    this.harStore.delete(sessionId);
    this.recordingStore.delete(sessionId);
    // Drop tracked contexts; they die with the browser, so just clear the refs.
    this.contexts.delete(sessionId);
    const browser = this.connections.get(sessionId);
    if (browser) {
      this.connections.delete(sessionId);
      try { void browser.disconnect(); } catch {}
    }
  }
}
