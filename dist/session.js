import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { launchBrowser, killBrowser } from "./launcher.js";
import { fireWebhook } from "./webhooks.js";
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
    async destroy(id) {
        const session = this.sessions.get(id);
        if (!session)
            return undefined;
        if (this.pool) {
            this.pool.release(session.browserProcess);
        }
        else {
            killBrowser(session.browserProcess);
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
        if (session)
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
                    process.stderr.write(`[anvil-engine] Session ${id} timed out after ${idleMs}ms idle\n`);
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
