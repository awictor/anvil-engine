import { type BrowserProcess, type LaunchOptions } from "./launcher.js";
import { type BrowserPool } from "./pool.js";
export interface Session {
    id: string;
    status: "live" | "idle" | "released";
    browserProcess: BrowserProcess;
    createdAt: number;
    lastActivityAt: number;
    options: LaunchOptions;
}
export declare class SessionManager {
    private sessions;
    private pool;
    constructor(pool?: BrowserPool);
    create(options?: LaunchOptions): Promise<Session>;
    get(id: string): Session | undefined;
    getActive(): Session | undefined;
    destroy(id: string): Promise<Session | undefined>;
    destroyAll(): Promise<number>;
    list(): Array<{
        id: string;
        status: string;
        cdpPort: number;
        ageMs: number;
    }>;
    touch(id: string): void;
    private cleanupTimer;
    startCleanup(timeoutMs: number): void;
    stopCleanup(): void;
    get size(): number;
}
