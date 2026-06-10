import { json } from "./http-utils.js";
/** Paths exempt from rate limiting and auth (operational endpoints). */
export const EXEMPT_PATHS = new Set(["/v1/health", "/v1/metrics", "/v1/docs", "/v1/ready", "/v1/live"]);
export function corsMiddleware() {
    return (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return false;
        }
        return true;
    };
}
export function rateLimitMiddleware(rateLimiter) {
    return (req, res, url) => {
        if (!rateLimiter || EXEMPT_PATHS.has(url.pathname))
            return true;
        const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
        const { allowed, retryAfterSec } = rateLimiter.consume(clientIp);
        if (!allowed) {
            res.setHeader("Retry-After", String(retryAfterSec));
            json(res, 429, { error: "Rate limit exceeded" });
            return false;
        }
        return true;
    };
}
export function authMiddleware(apiKey) {
    return (req, res, url) => {
        if (!apiKey || EXEMPT_PATHS.has(url.pathname))
            return true;
        const auth = req.headers.authorization || "";
        if (auth !== `Bearer ${apiKey}`) {
            json(res, 401, { error: "Unauthorized" });
            return false;
        }
        return true;
    };
}
/** Maps thrown errors to the response statuses the original handler used. */
export function errorToResponse(err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("too large") ? 413
        : message.includes("not found") || message.includes("Not found") ? 404
            : 500;
    return { status, body: { error: message } };
}
