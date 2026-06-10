export interface AnvilClientOptions {
  baseUrl: string;
  apiKey?: string;
}

export interface SessionCreateOptions {
  headless?: boolean;
  dimensions?: { width: number; height: number };
  proxyUrl?: string;
  userDataDir?: string;
  stealth?: boolean;
  userAgent?: string;
}

export class AnvilClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(options: AnvilClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey || "";
  }

  private headers(sessionId?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    if (sessionId) h["X-Session-Id"] = sessionId;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown, sessionId?: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(sessionId),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error: string }).error || `HTTP ${res.status}`);
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return res.json() as Promise<T>;
    return res.arrayBuffer() as unknown as T;
  }

  // Session lifecycle
  async createSession(options: SessionCreateOptions = {}) {
    return this.request<{ id: string; status: string; websocketUrl: string; cdpPort: number; fingerprint: boolean }>(
      "POST", "/v1/sessions", options,
    );
  }

  async getSession(sessionId?: string) {
    return this.request<{ id: string | null; status: string }>("GET", "/v1/sessions", undefined, sessionId);
  }

  async getSessionById(id: string) {
    return this.request<{ id: string; status: string; dimensions: { width: number; height: number }; userAgent: string | null }>(
      "GET", `/v1/sessions/${id}`,
    );
  }

  async listSessions() {
    return this.request<{ sessions: Array<{ id: string; status: string; cdpPort: number; ageMs: number }>; count: number }>(
      "GET", "/v1/sessions/list",
    );
  }

  async releaseSession(id: string) {
    return this.request<{ id: string; status: string; duration: number }>("POST", `/v1/sessions/${id}/release`);
  }

  async health() {
    return this.request<{ status: string; sessions: number; uptime: number; sessionTimeoutMs: number; multiSession: boolean }>(
      "GET", "/v1/health",
    );
  }

  // Navigation & content
  async navigate(url: string, options?: { waitUntil?: string; sessionId?: string }) {
    return this.request<{ url: string; title: string }>("POST", "/v1/actions/navigate", { url, waitUntil: options?.waitUntil }, options?.sessionId);
  }

  async scrape(url: string, options?: { format?: "html" | "text"; waitForSelector?: string; sessionId?: string }) {
    return this.request<{ content: string; title: string; url: string }>(
      "POST", "/v1/scrape", { url, format: options?.format, waitForSelector: options?.waitForSelector }, options?.sessionId,
    );
  }

  async pdf(options?: { url?: string; format?: string; landscape?: boolean; sessionId?: string }) {
    return this.request<ArrayBuffer>("POST", "/v1/pdf", { url: options?.url, format: options?.format, landscape: options?.landscape }, options?.sessionId);
  }

  async screenshot(options?: { fullPage?: boolean; sessionId?: string }) {
    const query = options?.fullPage ? "?fullPage=true" : "";
    return this.request<ArrayBuffer>("GET", `/v1/screenshot${query}`, undefined, options?.sessionId);
  }

  // Page actions
  async click(selector: string, options?: { button?: string; clickCount?: number; sessionId?: string }) {
    return this.request<{ success: boolean; selector: string }>(
      "POST", "/v1/actions/click", { selector, button: options?.button, clickCount: options?.clickCount }, options?.sessionId,
    );
  }

  async type(selector: string, text: string, options?: { delay?: number; sessionId?: string }) {
    return this.request<{ success: boolean; selector: string }>(
      "POST", "/v1/actions/type", { selector, text, delay: options?.delay }, options?.sessionId,
    );
  }

  async select(selector: string, values: string[], sessionId?: string) {
    return this.request<{ success: boolean; selector: string; selected: string[] }>(
      "POST", "/v1/actions/select", { selector, values }, sessionId,
    );
  }

  async hover(selector: string, sessionId?: string) {
    return this.request<{ success: boolean; selector: string }>("POST", "/v1/actions/hover", { selector }, sessionId);
  }

  async waitForSelector(selector: string, options?: { timeout?: number; sessionId?: string }) {
    return this.request<{ success: boolean; selector: string }>(
      "POST", "/v1/actions/wait", { selector, timeout: options?.timeout }, options?.sessionId,
    );
  }

  async evaluate(script: string, sessionId?: string) {
    return this.request<unknown>("POST", "/v1/actions/evaluate", { script }, sessionId);
  }

  async upload(selector: string, filename: string, data: string, sessionId?: string) {
    return this.request<{ success: boolean; selector: string; filename: string }>(
      "POST", "/v1/actions/upload", { selector, filename, data }, sessionId,
    );
  }

  // Cookies
  async getCookies(sessionId?: string) {
    return this.request<{ cookies: Array<Record<string, unknown>> }>("GET", "/v1/cookies", undefined, sessionId);
  }

  async setCookies(cookies: Array<Record<string, unknown>>, sessionId?: string) {
    return this.request<{ injected: number }>("POST", "/v1/cookies", { cookies }, sessionId);
  }

  // Pages / tabs
  async listPages(sessionId?: string) {
    return this.request<{ pages: Array<{ index: number; url: string; title: string }> }>(
      "GET", "/v1/pages", undefined, sessionId,
    );
  }

  async openPage(options?: { url?: string; sessionId?: string }) {
    return this.request<{ index: number; url: string }>("POST", "/v1/pages", { url: options?.url }, options?.sessionId);
  }

  async closePage(index: number, sessionId?: string) {
    return this.request<{ closed: number; remaining: number }>("DELETE", `/v1/pages/${index}`, undefined, sessionId);
  }

  // HAR
  async startHar(sessionId?: string) {
    return this.request<{ recording: boolean }>("POST", "/v1/har/start", undefined, sessionId);
  }

  async stopHar(sessionId?: string) {
    return this.request<{ recording: boolean; entries: number }>("POST", "/v1/har/stop", undefined, sessionId);
  }

  async getHar(sessionId?: string) {
    return this.request<{ entries: Array<{ url: string; method: string; status: number; duration: number; responseSize: number; timestamp: string }> }>(
      "GET", "/v1/har", undefined, sessionId,
    );
  }

  // Network
  async intercept(enabled: boolean, options?: { blockPatterns?: string[]; sessionId?: string }) {
    return this.request<{ enabled: boolean; blocking: number }>(
      "POST", "/v1/intercept", { enabled, blockPatterns: options?.blockPatterns }, options?.sessionId,
    );
  }

  // Downloads
  async listDownloads(sessionId?: string) {
    return this.request<{ files: Array<{ name: string; size: number; createdAt: string }> }>("GET", "/v1/downloads", undefined, sessionId);
  }

  async getDownload(filename: string, sessionId?: string) {
    return this.request<ArrayBuffer>("GET", `/v1/downloads/${encodeURIComponent(filename)}`, undefined, sessionId);
  }

  // Recording
  async startRecording(sessionId?: string) {
    return this.request<{ recording: boolean; sessionId: string }>("POST", "/v1/recording/start", undefined, sessionId);
  }

  async stopRecording(sessionId?: string) {
    return this.request<{ recording: boolean; actions: number }>("POST", "/v1/recording/stop", undefined, sessionId);
  }

  async getRecording(sessionId?: string) {
    return this.request<{ recording: boolean; actions: Array<{ action: string; params: Record<string, unknown>; timestamp: string; durationMs: number }> }>(
      "GET", "/v1/recording", undefined, sessionId,
    );
  }

  // Observability
  async metrics() {
    return this.request<{ sessionsCreated: number; sessionsReleased: number; peakConcurrent: number; requestsServed: number; errorsCount: number; activeSessions: number; uptime: number }>(
      "GET", "/v1/metrics",
    );
  }

  async docs() {
    return this.request<{ version: string; endpoints: number; categories: Record<string, unknown> }>("GET", "/v1/docs");
  }
}
