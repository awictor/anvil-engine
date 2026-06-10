import { createLogger } from "./logger.js";
const logger = createLogger("browser");
const CRASH_PATTERNS = /(Target closed|Session closed|Protocol error|WebSocket is not open|connect ECONNREFUSED|browser has disconnected|Browser connection failed)/i;
export function isCrashError(err) {
    return err instanceof Error && CRASH_PATTERNS.test(err.message);
}
async function connect(wsEndpoint) {
    const puppeteer = await import("puppeteer-core");
    try {
        return await puppeteer.default.connect({ browserWSEndpoint: wsEndpoint });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Browser connection failed (session may have crashed): ${msg}`);
    }
}
export async function withBrowser(wsEndpoint, fn, relaunch = null) {
    let endpoint = wsEndpoint;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
        let browser = null;
        try {
            browser = await connect(endpoint);
            const pages = await browser.pages();
            const page = pages[0] || (await browser.newPage());
            return await fn(page, browser);
        }
        catch (err) {
            lastErr = err;
            if (attempt === 0 && relaunch && isCrashError(err)) {
                logger.warn("Browser crashed, relaunching for retry", { error: err instanceof Error ? err.message : String(err) });
                try {
                    endpoint = await relaunch();
                    continue;
                }
                catch (relaunchErr) {
                    logger.error("Relaunch failed", { error: relaunchErr instanceof Error ? relaunchErr.message : String(relaunchErr) });
                    throw err;
                }
            }
            throw err;
        }
        finally {
            if (browser) {
                try {
                    browser.disconnect();
                }
                catch (err) {
                    logger.debug("Disconnect after request failed", { error: err instanceof Error ? err.message : String(err) });
                }
            }
        }
    }
    throw lastErr;
}
