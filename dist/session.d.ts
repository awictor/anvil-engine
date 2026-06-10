import { type BrowserProcess, type LaunchOptions } from "./launcher.js";
import { type BrowserPool } from "./pool.js";
export interface Session {
    id: string;
    status: "live" | "idle" | "released";
    browserProcess: BrowserProcess;
    createdAt: number;
    lastActivityAt: number;
    options: LaunchOptions;
    /** In-flight browser operations; destroy() waits for this to drain. */
    inFlight: number;
    /** Set when destroy() starts — blocks new work on this session. */
    destroying: boolean;
}
export declare class SessionManager {
    private sessions;
    private pool;
    constructor(pool?: BrowserPool);
    create(options?: LaunchOptions): Promise<Session>;
    get(id: string): Session | undefined;
    getActive(): Session | undefined;
    /**
     * Marks a browser operation as in-flight. Returns false when the session
     * is being destroyed (callers must not start new work). Always pair with
     * endRequest() in a finally block.
     */
    beginRequest(id: string): boolean;
    endRequest(id: string): void;
    destroy(id: string): Promise<Session | undefined>;
    /** Hook invoked at the start of destroy — used to release per-session resources (cached connections, HAR stores). */
    onDestroy: ((session: Session) => void) | null;
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
