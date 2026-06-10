export function json(res, status, data) {
    if (res.headersSent)
        return;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}
const MAX_BODY_BYTES = 1_048_576; // 1 MB
export function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
                req.destroy();
                reject(new Error("Request body too large"));
                return;
            }
            chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
        req.on("error", reject);
    });
}
export function resolveSession(sessionManager, req, url) {
    const explicitId = req.headers["x-session-id"] || url.searchParams.get("sessionId") || "";
    if (explicitId) {
        const session = sessionManager.get(explicitId);
        if (!session)
            return { error: { status: 404, body: { error: "Session not found" } } };
        return { session };
    }
    const session = sessionManager.getActive();
    if (!session)
        return { error: { status: 400, body: { error: "No active session" } } };
    return { session };
}
