import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { launchBrowser, killBrowser, type BrowserProcess, type LaunchOptions } from "./launcher.js";
import { type BrowserPool } from "./pool.js";

export interface Session {
  id: string;
  status: "live" | "idle" | "released";
  browserProcess: BrowserProcess;
  createdAt: number;
  options: LaunchOptions;
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

    const session: Session = {
      id,
      status: "live",
      browserProcess,
      createdAt: Date.now(),
      options,
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

  async destroy(id: string): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    if (this.pool) {
      this.pool.release(session.browserProcess);
    } else {
      killBrowser(session.browserProcess);
    }

    if (session.browserProcess.downloadDir) {
      try { rmSync(session.browserProcess.downloadDir, { recursive: true, force: true }); } catch {}
    }

    session.status = "released";
    this.sessions.delete(id);
    return session;
  }

  async destroyAll(): Promise<number> {
    let count = 0;
    for (const [id] of this.sessions) {
      await this.destroy(id);
      count++;
    }
    return count;
  }

  list(): Array<{ id: string; status: string; cdpPort: number; ageMs: number }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      status: s.status,
      cdpPort: s.browserProcess.cdpPort,
      ageMs: Date.now() - s.createdAt,
    }));
  }

  get size(): number {
    return this.sessions.size;
  }
}
