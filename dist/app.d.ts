import { type Server } from "node:http";
import { SessionManager } from "./session.js";
import { SessionActions } from "./actions.js";
import { BrowserPool } from "./pool.js";
import { RateLimiter } from "./rate-limiter.js";
import { type Config } from "./config.js";
export interface App {
    server: Server;
    sessionManager: SessionManager;
    actions: SessionActions;
    pool?: BrowserPool;
    rateLimiter: RateLimiter | null;
    config: Config;
    start(): Promise<void>;
    stop(): Promise<void>;
}
export declare function buildApp(config: Config): App;
