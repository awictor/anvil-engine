import { launchBrowser, killBrowser } from "./launcher.js";
export class BrowserPool {
    warm = [];
    maxSize;
    constructor(maxSize = 3) {
        this.maxSize = maxSize;
    }
    async init() {
        const launches = Array.from({ length: this.maxSize }, () => launchBrowser({ headless: true, stealth: true }));
        const results = await Promise.allSettled(launches);
        for (const result of results) {
            if (result.status === "fulfilled") {
                this.warm.push(result.value);
            }
        }
    }
    async acquire(options = {}) {
        if (this.warm.length > 0) {
            return this.warm.pop();
        }
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Browser launch timed out after 30s")), 30000));
        return Promise.race([launchBrowser(options), timeout]);
    }
    release(proc) {
        killBrowser(proc);
    }
    async shutdown() {
        for (const proc of this.warm) {
            killBrowser(proc);
        }
        this.warm = [];
    }
    get available() {
        return this.warm.length;
    }
    get size() {
        return this.maxSize;
    }
}
