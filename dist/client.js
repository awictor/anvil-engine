export class AnvilClient {
    baseUrl;
    apiKey;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/$/, "");
        this.apiKey = options.apiKey || "";
    }
    headers(sessionId) {
        const h = { "Content-Type": "application/json" };
        if (this.apiKey)
            h["Authorization"] = `Bearer ${this.apiKey}`;
        if (sessionId)
            h["X-Session-Id"] = sessionId;
        return h;
    }
    async request(method, path, body, sessionId) {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: this.headers(sessionId),
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json"))
            return res.json();
        return res.arrayBuffer();
    }
    // Session lifecycle
    async createSession(options = {}) {
        return this.request("POST", "/v1/sessions", options);
    }
    async getSession(sessionId) {
        return this.request("GET", "/v1/sessions", undefined, sessionId);
    }
    async getSessionById(id) {
        return this.request("GET", `/v1/sessions/${id}`);
    }
    async listSessions() {
        return this.request("GET", "/v1/sessions/list");
    }
    async releaseSession(id) {
        return this.request("POST", `/v1/sessions/${id}/release`);
    }
    async health() {
        return this.request("GET", "/v1/health");
    }
    // Navigation & content
    async navigate(url, options) {
        return this.request("POST", "/v1/actions/navigate", { url, waitUntil: options?.waitUntil }, options?.sessionId);
    }
    async scrape(url, options) {
        return this.request("POST", "/v1/scrape", { url, format: options?.format, waitForSelector: options?.waitForSelector }, options?.sessionId);
    }
    async pdf(options) {
        return this.request("POST", "/v1/pdf", { url: options?.url, format: options?.format, landscape: options?.landscape }, options?.sessionId);
    }
    async screenshot(options) {
        const query = options?.fullPage ? "?fullPage=true" : "";
        return this.request("GET", `/v1/screenshot${query}`, undefined, options?.sessionId);
    }
    // Page actions
    async click(selector, options) {
        return this.request("POST", "/v1/actions/click", { selector, button: options?.button, clickCount: options?.clickCount }, options?.sessionId);
    }
    async type(selector, text, options) {
        return this.request("POST", "/v1/actions/type", { selector, text, delay: options?.delay }, options?.sessionId);
    }
    async select(selector, values, sessionId) {
        return this.request("POST", "/v1/actions/select", { selector, values }, sessionId);
    }
    async hover(selector, sessionId) {
        return this.request("POST", "/v1/actions/hover", { selector }, sessionId);
    }
    async waitForSelector(selector, options) {
        return this.request("POST", "/v1/actions/wait", { selector, timeout: options?.timeout }, options?.sessionId);
    }
    async evaluate(script, sessionId) {
        return this.request("POST", "/v1/actions/evaluate", { script }, sessionId);
    }
    async upload(selector, filename, data, sessionId) {
        return this.request("POST", "/v1/actions/upload", { selector, filename, data }, sessionId);
    }
    // Cookies
    async getCookies(sessionId) {
        return this.request("GET", "/v1/cookies", undefined, sessionId);
    }
    async setCookies(cookies, sessionId) {
        return this.request("POST", "/v1/cookies", { cookies }, sessionId);
    }
    // HAR
    async startHar(sessionId) {
        return this.request("POST", "/v1/har/start", undefined, sessionId);
    }
    async stopHar(sessionId) {
        return this.request("POST", "/v1/har/stop", undefined, sessionId);
    }
    async getHar(sessionId) {
        return this.request("GET", "/v1/har", undefined, sessionId);
    }
    // Network
    async intercept(enabled, options) {
        return this.request("POST", "/v1/intercept", { enabled, blockPatterns: options?.blockPatterns }, options?.sessionId);
    }
    // Downloads
    async listDownloads(sessionId) {
        return this.request("GET", "/v1/downloads", undefined, sessionId);
    }
    async getDownload(filename, sessionId) {
        return this.request("GET", `/v1/downloads/${encodeURIComponent(filename)}`, undefined, sessionId);
    }
    // Recording
    async startRecording(sessionId) {
        return this.request("POST", "/v1/recording/start", undefined, sessionId);
    }
    async stopRecording(sessionId) {
        return this.request("POST", "/v1/recording/stop", undefined, sessionId);
    }
    async getRecording(sessionId) {
        return this.request("GET", "/v1/recording", undefined, sessionId);
    }
    // Observability
    async metrics() {
        return this.request("GET", "/v1/metrics");
    }
    async docs() {
        return this.request("GET", "/v1/docs");
    }
}
