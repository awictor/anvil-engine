import { type BrowserProcess, type LaunchOptions } from "./launcher.js";
export declare class BrowserPool {
    private warm;
    private maxSize;
    constructor(maxSize?: number);
    init(): Promise<void>;
    acquire(options?: LaunchOptions): Promise<BrowserProcess>;
    release(proc: BrowserProcess): void;
    shutdown(): Promise<void>;
    get available(): number;
    get size(): number;
}
