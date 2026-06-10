import { spawn, type ChildProcess } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface LaunchOptions {
  headless?: boolean;
  width?: number;
  height?: number;
  userDataDir?: string;
  proxy?: string;
  stealth?: boolean;
  userAgent?: string;
  args?: string[];
}

export interface ProxyCredentials {
  username: string;
  password: string;
}

export interface BrowserProcess {
  pid: number;
  process: ChildProcess;
  cdpPort: number;
  wsEndpoint: string;
  proxyCredentials?: ProxyCredentials;
  downloadDir?: string;
}

const CHROME_PATHS: Record<string, string[]> = {
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

function findChromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const paths = CHROME_PATHS[platform()] || CHROME_PATHS.linux;
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `Chrome not found. Set CHROME_PATH env var or install Chrome. Searched: ${paths.join(", ")}`,
  );
}

let nextPort = 9222;

export function getNextCdpPort(): number {
  return nextPort++;
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^::$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe80:/i,
];

const ALLOWED_PROXY_SCHEMES = new Set(["http:", "https:", "socks:", "socks4:", "socks5:"]);

function extractBareHost(proxy: string): string {
  if (proxy.startsWith("[")) {
    const end = proxy.indexOf("]");
    return end > 0 ? proxy.slice(1, end) : proxy;
  }
  return proxy.split(":")[0];
}

export function validateProxyUrl(proxy: string): void {
  if (process.env.ANVIL_ALLOW_PRIVATE_PROXY === "true") return;

  let hostname: string;
  try {
    const url = new URL(proxy);
    if (ALLOWED_PROXY_SCHEMES.has(url.protocol)) {
      hostname = url.hostname;
    } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(proxy)) {
      throw new Error(`Unsupported proxy scheme: ${url.protocol} (allowed: http, https, socks, socks4, socks5)`);
    } else {
      // Bare host:port that still parses as a URL (e.g. "proxy.example.com:8080")
      hostname = extractBareHost(proxy);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unsupported proxy scheme")) throw err;
    hostname = extractBareHost(proxy);
  }

  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  for (const pattern of PRIVATE_HOST_PATTERNS) {
    if (pattern.test(host)) {
      throw new Error(
        `Proxy host "${host}" is private or internal and not allowed. Set ANVIL_ALLOW_PRIVATE_PROXY=true to override.`,
      );
    }
  }
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<BrowserProcess> {
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
    args.push(
      "--disable-blink-features=AutomationControlled",
      "--disable-features=AutomationControlled",
      "--disable-infobars",
    );
  }

  if (options.userDataDir) {
    args.push(`--user-data-dir=${options.userDataDir}`);
  } else {
    args.push("--incognito");
  }

  let proxyCredentials: ProxyCredentials | undefined;
  if (options.proxy) {
    validateProxyUrl(options.proxy);
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
      } else {
        args.push(`--proxy-server=${options.proxy}`);
      }
    } catch {
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
    pid: proc.pid!,
    process: proc,
    cdpPort,
    wsEndpoint,
    proxyCredentials,
    downloadDir,
  };
}

async function waitForCdp(port: number, timeoutMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const data = await res.json();
        return data.webSocketDebuggerUrl as string;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chrome CDP did not start on port ${port} within ${timeoutMs}ms`);
}

export function killBrowser(proc: BrowserProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.process.exitCode !== null || proc.process.signalCode !== null) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve();
    };

    proc.process.once("exit", finish);
    proc.process.once("close", finish);

    const killTimer = setTimeout(() => {
      try {
        if (!proc.process.killed) proc.process.kill("SIGKILL");
      } catch {}
      // Give SIGKILL a moment; resolve regardless so callers never hang
      setTimeout(finish, 1000);
    }, 3000);

    try {
      proc.process.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}
