import type { IncomingMessage, ServerResponse } from "node:http";
import { type Session, type SessionManager } from "./session.js";
export declare function json(res: ServerResponse, status: number, data: unknown): void;
export declare function readBody(req: IncomingMessage): Promise<string>;
export type ResolveResult = {
    session: Session;
    error?: never;
} | {
    session?: never;
    error: {
        status: number;
        body: {
            error: string;
        };
    };
};
export declare function resolveSession(sessionManager: SessionManager, req: IncomingMessage, url: URL): ResolveResult;
