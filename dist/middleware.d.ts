import type { IncomingMessage, ServerResponse } from "node:http";
import { type RateLimiter } from "./rate-limiter.js";
/**
 * Middleware returns true to continue the chain, false when it has already
 * ended the response. Order is load-bearing and mirrors the original inline
 * checks: CORS -> OPTIONS short-circuit -> rate limit -> auth.
 */
export type Middleware = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
/** Paths exempt from rate limiting and auth (operational endpoints). */
export declare const EXEMPT_PATHS: Set<string>;
export declare function corsMiddleware(): Middleware;
export declare function rateLimitMiddleware(rateLimiter: RateLimiter | null): Middleware;
export declare function authMiddleware(apiKey: string): Middleware;
/** Maps thrown errors to the response statuses the original handler used. */
export declare function errorToResponse(err: unknown): {
    status: number;
    body: {
        error: string;
    };
};
