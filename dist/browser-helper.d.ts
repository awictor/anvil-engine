import type { Page, Browser } from "puppeteer-core";
export declare function withBrowser<T>(wsEndpoint: string, fn: (page: Page, browser: Browser) => Promise<T>): Promise<T>;
