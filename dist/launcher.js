import { spawn } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const CHROME_PATHS = {
    win32: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
    linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ],
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
};
function findChromePath() {
    if (process.env.CHROME_PATH)
        return process.env.CHROME_PATH;
    const paths = CHROME_PATHS[platform()] || CHROME_PATHS.linux;
    for (const p of paths) {
        if (existsSync(p))
            return p;
    }
    throw new Error(`Chrome not found. Set CHROME_PATH env var or install Chrome. Searched: ${paths.join(", ")}`);
}
let nextPort = 9222;
export function getNextCdpPort() {
    return nextPort++;
}
export async function launchBrowser(options = {}) {
    const chromePath = findChromePath();
    const cdpPort = getNextCdpPort();
    const width = options.width || 1920;
    const height = options.height || 1080;
    const args = [
        `--remote-debugging-port=${cdpPort}`,
        `--window-size=${width},${height}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-sync",
        "--metrics-recording-only",
        "--disable-default-apps",
        "--mute-audio",
        "--no-sandbox",
    ];
    if (options.headless !== false) {
        args.push("--headless=new");
    }
    if (options.stealth !== false) {
        args.push("--disable-blink-features=AutomationControlled", "--disable-features=AutomationControlled", "--disable-infobars");
    }
    if (options.userDataDir) {
        args.push(`--user-data-dir=${options.userDataDir}`);
    }
    else {
        args.push("--incognito");
    }
    let proxyCredentials;
    if (options.proxy) {
        try {
            const proxyUrl = new URL(options.proxy);
            if (proxyUrl.username && proxyUrl.password) {
                proxyCredentials = {
                    username: decodeURIComponent(proxyUrl.username),
                    password: decodeURIComponent(proxyUrl.password),
                };
                // Strip credentials from the URL for --proxy-server flag
                proxyUrl.username = "";
                proxyUrl.password = "";
                args.push(`--proxy-server=${proxyUrl.host}`);
            }
            else {
                args.push(`--proxy-server=${options.proxy}`);
            }
        }
        catch {
            // Not a valid URL — pass as-is (e.g., "host:port")
            args.push(`--proxy-server=${options.proxy}`);
        }
    }
    // Per-session download directory
    const downloadDir = join(tmpdir(), `anvil-downloads-${randomUUID()}`);
    mkdirSync(downloadDir, { recursive: true });
    args.push(`--download-default-directory=${downloadDir}`);
    if (options.args) {
        args.push(...options.args);
    }
    args.push("about:blank");
    const proc = spawn(chromePath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
    });
    // Wait for CDP to be ready
    const wsEndpoint = await waitForCdp(cdpPort, 10000);
    return {
        pid: proc.pid,
        process: proc,
        cdpPort,
        wsEndpoint,
        proxyCredentials,
        downloadDir,
    };
}
async function waitForCdp(port, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (res.ok) {
                const data = await res.json();
                return data.webSocketDebuggerUrl;
            }
        }
        catch {
            // Not ready yet
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Chrome CDP did not start on port ${port} within ${timeoutMs}ms`);
}
export function killBrowser(proc) {
    try {
        proc.process.kill("SIGTERM");
    }
    catch {
        // Already dead
    }
    setTimeout(() => {
        try {
            if (!proc.process.killed)
                proc.process.kill("SIGKILL");
        }
        catch { }
    }, 3000);
}
