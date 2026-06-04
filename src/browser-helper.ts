import type { Page, Browser } from "puppeteer-core";

export async function withBrowser<T>(
  wsEndpoint: string,
  fn: (page: Page, browser: Browser) => Promise<T>,
): Promise<T> {
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.default.connect({ browserWSEndpoint: wsEndpoint });
  try {
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    return await fn(page, browser);
  } finally {
    browser.disconnect();
  }
}
