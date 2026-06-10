import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { launchBrowser, killBrowser } from "./launcher.js";
import { fireWebhook } from "./webhooks.js";
import { createLogger } from "./logger.js";
const logger = createLogger("session");
export class SessionManager {
    sessions = new Map();
    pool;
    constructor(pool) {
        this.pool = pool || null;
    }
    async create(options = {}) {
        const id = randomUUID();
        const browserProcess = this.pool
            ? await this.pool.acquire(options)
            : await launchBrowser(options);
        const now = Date.now();
        const session = {
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
    get(id) {
        return this.sessions.get(id);
    }
    getActive() {
        for (const session of this.sessions.values()) {
            if (session.status === "live")
                return session;
        }
        return undefined;
    }
    /**
     * Marks a browser operation as in-flight. Returns false when the session
     * is being destroyed (callers must not start new work). Always pair with
     * endRequest() in a finally block.
     */
    beginRequest(id) {
        const session = this.sessions.get(id);
        if (!session || session.destroying)
            return false;
        session.inFlight++;
        return true;
    }
    endRequest(id) {
        const session = this.sessions.get(id);
        if (session && session.inFlight > 0)
            session.inFlight--;
    }
    async destroy(id) {
        const session = this.sessions.get(id);
        if (!session || session.destroying)
            return undefined;
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
        }
        else {
            await killBrowser(session.browserProcess);
        }
        if (session.browserProcess.downloadDir) {
            try {
                rmSync(session.browserProcess.downloadDir, { recursive: true, force: true });
            }
            catch { }
        }
        session.status = "released";
        this.sessions.delete(id);
        return session;
    }
    /** Hook invoked at the start of destroy — used to release per-session resources (cached connections, HAR stores). */
    onDestroy = null;
    async destroyAll() {
        let count = 0;
        for (const [id] of this.sessions) {
            await this.destroy(id);
            count++;
        }
        return count;
    }
    list() {
        return [...this.sessions.values()].map((s) => ({
            id: s.id,
            status: s.status,
            cdpPort: s.browserProcess.cdpPort,
            ageMs: Date.now() - s.createdAt,
        }));
    }
    touch(id) {
        const session = this.sessions.get(id);
        if (session && !session.destroying)
            session.lastActivityAt = Date.now();
    }
    cleanupTimer = null;
    startCleanup(timeoutMs) {
        if (timeoutMs <= 0)
            return;
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [id, session] of this.sessions) {
                const idleMs = now - session.lastActivityAt;
                if (idleMs > timeoutMs) {
                    logger.info("Session timed out", { sessionId: id, idleMs });
                    this.destroy(id);
                    fireWebhook("session.timed_out", id);
                }
            }
        }, 30000);
    }
    stopCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    get size() {
        return this.sessions.size;
    }
}
