import { type ChildProcess } from "node:child_process";
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
export declare function findChromePath(): string;
export declare function getNextCdpPort(): number;
export declare function validateProxyUrl(proxy: string): void;
export declare function launchBrowser(options?: LaunchOptions): Promise<BrowserProcess>;
export declare function killBrowser(proc: BrowserProcess): Promise<void>;
