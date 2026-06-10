import { launchBrowser, killBrowser } from "./launcher.js";
import { isCrashError } from "./browser-helper.js";
import { createLogger } from "./logger.js";
const logger = createLogger("actions");
/**
 * Browser business logic, decoupled from the HTTP layer. Owns one cached
 * puppeteer connection per session (invalidated on crash/destroy), the
 * HAR/recording stores, and their page listeners — all released via
 * SessionManager.onDestroy so nothing leaks when a session dies.
 */
export class SessionActions {
    sessionManager;
    config;
    connections = new Map();
    harStore = new Map();
    harListeners = new Map();
    interceptListeners = new Map();
    recordingStore = new Map();
    constructor(sessionManager, config = { evaluateTimeoutMs: 30000, harMaxEntries: 5000 }) {
        this.sessionManager = sessionManager;
        this.config = config;
        sessionManager.onDestroy = (session) => this.releaseSessionResources(session.id);
    }
    // --- connection lifecycle ---
    async getBrowser(session) {
        const cached = this.connections.get(session.id);
        if (cached && cached.connected)
            return cached;
        if (cached)
            this.connections.delete(session.id);
        const puppeteer = await import("puppeteer-core");
        let browser;
        try {
            browser = await puppeteer.default.connect({ browserWSEndpoint: session.browserProcess.wsEndpoint });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Browser connection failed (session may have crashed): ${msg}`);
        }
        this.connections.set(session.id, browser);
        return browser;
    }
    invalidate(sessionId) {
        const browser = this.connections.get(sessionId);
        if (browser) {
            this.connections.delete(sessionId);
            try {
                void browser.disconnect();
            }
            catch { }
        }
        // Listeners died with the connection; drop the trackers (collected data stays).
        this.harListeners.delete(sessionId);
        this.interceptListeners.delete(sessionId);
    }
    async relaunch(session) {
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
    async run(session, fn) {
        if (!this.sessionManager.beginRequest(session.id)) {
            throw new Error("Session not found");
        }
        try {
            for (let attempt = 0;; attempt++) {
                try {
                    const browser = await this.getBrowser(session);
                    const pages = await browser.pages();
                    const page = pages[0] || (await browser.newPage());
                    return await fn(page, browser);
                }
                catch (err) {
                    this.invalidate(session.id);
                    if (attempt === 0 && isCrashError(err)) {
                        await this.relaunch(session);
                        continue;
                    }
                    throw err;
                }
            }
        }
        finally {
            this.sessionManager.endRequest(session.id);
        }
    }
    async authenticated(session, page) {
        if (session.browserProcess.proxyCredentials) {
            await page.authenticate(session.browserProcess.proxyCredentials);
        }
    }
    // --- session setup ---
    async applySessionDefaults(session, opts) {
        await this.run(session, async (page) => {
            if (opts.userAgent)
                await page.setUserAgent(opts.userAgent);
            await page.setViewport({ width: opts.width, height: opts.height });
            if (opts.fingerprintScript)
                await page.evaluateOnNewDocument(opts.fingerprintScript);
        });
    }
    // --- navigation & content ---
    async navigate(session, params) {
        return this.run(session, async (page) => {
            await this.authenticated(session, page);
            await page.goto(params.url, {
                waitUntil: params.waitUntil || "networkidle2",
                timeout: Math.min(params.timeout || 30000, 60000),
            });
            return { url: page.url(), title: await page.title() };
        });
    }
    async scrape(session, params) {
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
    async pdf(session, params) {
        return this.run(session, async (page) => {
            await this.authenticated(session, page);
            if (params.url) {
                await page.goto(params.url, { waitUntil: "networkidle2", timeout: 60000 });
            }
            return page.pdf({
                format: params.format || "A4",
                landscape: params.landscape || false,
                printBackground: true,
            });
        });
    }
    async screenshot(session, fullPage) {
        return this.run(session, (page) => page.screenshot({ fullPage, encoding: "binary" }));
    }
    async getCookies(session) {
        return this.run(session, (page) => page.cookies());
    }
    async setCookies(session, cookies) {
        await this.run(session, (page) => page.setCookie(...cookies));
        return cookies.length;
    }
    // --- element actions ---
    async click(session, params) {
        await this.run(session, (page) => page.click(params.selector, {
            button: params.button || "left",
            clickCount: params.clickCount || 1,
        }));
    }
    async type(session, params) {
        await this.run(session, (page) => page.type(params.selector, params.text, { delay: Math.min(params.delay || 0, 500) }));
    }
    async select(session, params) {
        return this.run(session, (page) => page.select(params.selector, ...params.values));
    }
    async hover(session, selector) {
        await this.run(session, (page) => page.hover(selector));
    }
    async wait(session, params) {
        await this.run(session, async (page) => {
            await page.waitForSelector(params.selector, { timeout: Math.min(params.timeout || 10000, 60000) });
        });
    }
    async upload(session, params) {
        await this.run(session, async (page) => {
            const input = (await page.$(params.selector));
            if (!input)
                throw new Error(`Element not found: ${params.selector}`);
            await input.uploadFile(params.tempPath);
        });
    }
    async evaluate(session, script) {
        return this.run(session, async (page) => {
            // A CDP session lets us Runtime.terminateExecution on timeout — without
            // it a while(true) script wedges the page thread forever even though
            // the HTTP caller got a timeout error.
            const client = await page.createCDPSession();
            let timer;
            let timedOut = false;
            try {
                const timeout = new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        timedOut = true;
                        client.send("Runtime.terminateExecution").catch(() => { });
                        reject(new Error(`Script execution timed out after ${this.config.evaluateTimeoutMs}ms`));
                    }, this.config.evaluateTimeoutMs);
                });
                try {
                    return await Promise.race([page.evaluate(script), timeout]);
                }
                catch (err) {
                    if (timedOut)
                        throw new Error(`Script execution timed out after ${this.config.evaluateTimeoutMs}ms`);
                    throw err;
                }
            }
            finally {
                if (timer)
                    clearTimeout(timer);
                client.detach().catch(() => { });
            }
        });
    }
    // --- HAR recording ---
    async startHar(session) {
        this.harStore.set(session.id, []);
        await this.run(session, async (page) => {
            // Idempotent: drop any previous listener before attaching a new one.
            this.removeHarListener(session.id);
            const listener = (response) => {
                void (async () => {
                    const entries = this.harStore.get(session.id);
                    if (!entries || entries.length >= this.config.harMaxEntries)
                        return;
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
                    }
                    catch {
                        // Skip failed entries
                    }
                })();
            };
            page.on("response", listener);
            this.harListeners.set(session.id, { page, listener });
        });
    }
    stopHar(session) {
        this.removeHarListener(session.id);
        return this.harStore.get(session.id) || [];
    }
    getHar(session) {
        return this.harStore.get(session.id) || [];
    }
    removeHarListener(sessionId) {
        const tracked = this.harListeners.get(sessionId);
        if (tracked) {
            try {
                tracked.page.off("response", tracked.listener);
            }
            catch { }
            this.harListeners.delete(sessionId);
        }
    }
    // --- request interception ---
    async setIntercept(session, enabled, blockPatterns) {
        await this.run(session, async (page) => {
            const tracked = this.interceptListeners.get(session.id);
            if (tracked) {
                try {
                    tracked.page.off("request", tracked.listener);
                }
                catch { }
                this.interceptListeners.delete(session.id);
            }
            if (enabled) {
                await page.setRequestInterception(true);
                const listener = (req) => {
                    if (blockPatterns.some((p) => req.url().includes(p))) {
                        req.abort().catch(() => { });
                    }
                    else {
                        req.continue().catch(() => { });
                    }
                };
                page.on("request", listener);
                this.interceptListeners.set(session.id, { page, listener });
            }
            else {
                await page.setRequestInterception(false);
            }
        });
    }
    // --- action recording ---
    startRecording(session) {
        this.recordingStore.set(session.id, []);
    }
    stopRecording(session) {
        const entries = this.recordingStore.get(session.id) || [];
        this.recordingStore.delete(session.id);
        return entries;
    }
    getRecording(session) {
        return {
            recording: this.recordingStore.has(session.id),
            actions: this.recordingStore.get(session.id) || [],
        };
    }
    recordAction(sessionId, action, params, durationMs) {
        const entries = this.recordingStore.get(sessionId);
        if (!entries)
            return;
        entries.push({ action, params, timestamp: new Date().toISOString(), durationMs });
    }
    // --- cleanup (called from SessionManager.onDestroy) ---
    releaseSessionResources(sessionId) {
        this.removeHarListener(sessionId);
        const intercept = this.interceptListeners.get(sessionId);
        if (intercept) {
            try {
                intercept.page.off("request", intercept.listener);
            }
            catch { }
            this.interceptListeners.delete(sessionId);
        }
        this.harStore.delete(sessionId);
        this.recordingStore.delete(sessionId);
        const browser = this.connections.get(sessionId);
        if (browser) {
            this.connections.delete(sessionId);
            try {
                void browser.disconnect();
            }
            catch { }
        }
    }
}
