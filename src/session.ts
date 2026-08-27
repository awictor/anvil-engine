import { randomUUID } from "node:crypto";
import { launchBrowser, killBrowser, removeDownloadDir, type BrowserProcess, type LaunchOptions } from "./launcher.js";
import { type BrowserPool } from "./pool.js";
import { fireWebhook } from "./webhooks.js";
import { createLogger } from "./logger.js";

const logger = createLogger("session");

export interface Session {
  id: string;
  status: "live" | "idle" | "released";
  browserProcess: BrowserProcess;
  createdAt: number;
  lastActivityAt: number;
  options: LaunchOptions;
  /** In-flight browser operations; destroy() waits for this to drain. */
  inFlight: number;
  /** Set when destroy() starts — blocks new work on this session. */
  destroying: boolean;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private pool: BrowserPool | null;

  constructor(pool?: BrowserPool) {
    this.pool = pool || null;
  }

  async create(options: LaunchOptions = {}): Promise<Session> {
    const id = randomUUID();
    const browserProcess = this.pool
      ? await this.pool.acquire(options)
      : await launchBrowser(options);

    const now = Date.now();
    const session: Session = {
      id,
      status: "live",
      browserProcess,
      createdAt: now,
      lastActivityAt: now,
      options,
      inFlight: 0,
      destroying: false,
    };

    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getActive(): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.status === "live") return session;
    }
    return undefined;
  }

  /**
   * Marks a browser operation as in-flight. Returns false when the session
   * is being destroyed (callers must not start new work). Always pair with
   * endRequest() in a finally block.
   */
  beginRequest(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.destroying) return false;
    session.inFlight++;
    return true;
  }

  endRequest(id: string): void {
    const session = this.sessions.get(id);
    if (session && session.inFlight > 0) session.inFlight--;
  }

  async destroy(id: string): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    if (!session || session.destroying) return undefined;
    session.destroying = true;

    // Let in-flight operations drain before killing the browser (5s grace).
    const deadline = Date.now() + 5000;
    while (session.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (session.inFlight > 0) {
      logger.warn("Destroying session with operations still in flight", { sessionId: id, inFlight: session.inFlight });
    }

    this.onDestroy?.(session);

    if (this.pool) {
      this.pool.release(session.browserProcess);
    } else {
      await killBrowser(session.browserProcess);
    }

    removeDownloadDir(session.browserProcess.downloadDir);

    session.status = "released";
    this.sessions.delete(id);
    return session;
  }

  /** Hook invoked at the start of destroy — used to release per-session resources (cached connections, HAR stores). */
  onDestroy: ((session: Session) => void) | null = null;

  async destroyAll(): Promise<number> {
    let count = 0;
    for (const [id] of this.sessions) {
      await this.destroy(id);
      count++;
    }
    return count;
  }

  list(): Array<{ id: string; status: string; cdpPort: number; ageMs: number; idleMs: number; inFlight: number }> {
    const now = Date.now();
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      status: s.status,
      cdpPort: s.browserProcess.cdpPort,
      ageMs: now - s.createdAt,
      // idleMs + inFlight let an operator pinpoint WHICH session is the leak culprit after
      // /v1/metrics.inFlightTotal flags one exists — a stuck one has inFlight>0 and a large idleMs (DEV-0159).
      idleMs: now - s.lastActivityAt,
      inFlight: s.inFlight,
    }));
  }

  touch(id: string): void {
    const session = this.sessions.get(id);
    if (session && !session.destroying) session.lastActivityAt = Date.now();
  }

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  startCleanup(timeoutMs: number): void {
    if (timeoutMs <= 0) return;
    this.cleanupTimer = setInterval(() => this.sweepIdle(Date.now(), timeoutMs), 30000);
  }

  /**
   * One reaper pass: destroy sessions idle longer than timeoutMs. A session with an operation IN
   * FLIGHT is NOT idle — a long action (e.g. a slow scrape) only touches lastActivityAt at request
   * start, so without the inFlight guard the reaper would destroy() a busy session and force-kill the
   * browser under a running handler after the 5s drain (DEV-0156). Extracted for unit-testability.
   * Returns the ids it reaped.
   */
  sweepIdle(now: number, timeoutMs: number): string[] {
    const reaped: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.inFlight > 0) continue;
      const idleMs = now - session.lastActivityAt;
      if (idleMs > timeoutMs) {
        logger.info("Session timed out", { sessionId: id, idleMs });
        this.destroy(id);
        fireWebhook("session.timed_out", id);
        reaped.push(id);
      }
    }
    return reaped;
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  get size(): number {
    return this.sessions.size;
  }

  /**
   * Aggregate lifecycle signals for observability (DEV-0158). inFlightTotal = sum of in-flight ops
   * across sessions (a session stuck >0 is un-reapable since DEV-0156, so this is the leak signal);
   * oldestAgeMs = age of the oldest session; oldestIdleMs = longest idle time. All 0 when no sessions.
   */
  lifecycleStats(now: number): { inFlightTotal: number; oldestAgeMs: number; oldestIdleMs: number } {
    let inFlightTotal = 0, oldestAgeMs = 0, oldestIdleMs = 0;
    for (const s of this.sessions.values()) {
      inFlightTotal += s.inFlight;
      oldestAgeMs = Math.max(oldestAgeMs, now - s.createdAt);
      oldestIdleMs = Math.max(oldestIdleMs, now - s.lastActivityAt);
    }
    return { inFlightTotal, oldestAgeMs, oldestIdleMs };
  }
}
