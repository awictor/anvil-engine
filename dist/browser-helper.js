export async function withBrowser(wsEndpoint, fn) {
    const puppeteer = await import("puppeteer-core");
    let browser;
    try {
        browser = await puppeteer.default.connect({ browserWSEndpoint: wsEndpoint });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Browser connection failed (session may have crashed): ${msg}`);
    }
    try {
        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        return await fn(page, browser);
    }
    finally {
        try {
            browser.disconnect();
        }
        catch { }
    }
}
