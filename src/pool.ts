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
    return launchBrowser(options);
  }

  release(proc: BrowserProcess): void {
    killBrowser(proc);
  }

  async shutdown(): Promise<void> {
    for (const proc of this.warm) {
      killBrowser(proc);
    }
    this.warm = [];
  }

  get available(): number {
    return this.warm.length;
  }

  get size(): number {
    return this.maxSize;
  }
}
