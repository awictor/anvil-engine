import { launchBrowser, killBrowser, type BrowserProcess, type LaunchOptions } from "./launcher.js";

export class BrowserPool {
  private warm: BrowserProcess[] = [];
  private maxSize: number;

  constructor(maxSize: number = 3) {
    this.maxSize = maxSize;
  }

  async init(): Promise<void> {
    const launches = Array.from({ length: this.maxSize }, () =>
      launchBrowser({ headless: true, stealth: true }),
    );
    const results = await Promise.allSettled(launches);
    for (const result of results) {
      if (result.status === "fulfilled") {
        this.warm.push(result.value);
      }
    }
  }

  async acquire(options: LaunchOptions = {}): Promise<BrowserProcess> {
    if (this.warm.length > 0) {
      return this.warm.pop()!;
    }
    // Race the launch against a 30s cap. The timer MUST be cleared on the launch-wins path — an
    // uncleared setTimeout keeps the Node event loop alive for the full 30s (process/tests hang long
    // after work is done, and repeated acquires pile up live timers).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Browser launch timed out after 30s")), 30000);
    });
    try {
      return await Promise.race([launchBrowser(options), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  release(proc: BrowserProcess): void {
    void killBrowser(proc);
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.warm.map((proc) => killBrowser(proc)));
    this.warm = [];
  }

  get available(): number {
    return this.warm.length;
  }

  get size(): number {
    return this.maxSize;
  }
}
