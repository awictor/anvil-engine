import { type SessionManager } from "../session.js";
import { type SessionActions } from "../actions.js";
import { type BrowserPool } from "../pool.js";
import { type Config } from "../config.js";
/** Shared dependencies injected into every route module by the composition root. */
export interface Deps {
    sessionManager: SessionManager;
    actions: SessionActions;
    pool?: BrowserPool;
    config: Config;
}
