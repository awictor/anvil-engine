import type { Page, Browser } from "puppeteer-core";
export declare function isCrashError(err: unknown): boolean;
export declare function withBrowser<T>(wsEndpoint: string, fn: (page: Page, browser: Browser) => Promise<T>, relaunch?: (() => Promise<string>) | null): Promise<T>;
