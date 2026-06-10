import { json } from "../http-utils.js";
import { counters as metrics, snapshot } from "../metrics.js";
export function healthRoutes(deps) {
    const { sessionManager, pool, config } = deps;
    return [
        {
            method: "GET",
            pattern: "/v1/health",
            handler: ({ res }) => {
                json(res, 200, {
                    status: "ok",
                    sessions: sessionManager.size,
                    uptime: process.uptime(),
                    sessionTimeoutMs: config.sessionTimeoutMs,
                    multiSession: true,
                });
            },
        },
        {
            // Liveness probe: process responsive. Operational endpoint — not part
            // of the 30-endpoint public API catalog in /v1/docs.
            method: "GET",
            pattern: "/v1/live",
            handler: ({ res }) => {
                json(res, 200, { status: "alive" });
            },
        },
        {
            // Readiness probe: able to take traffic (pool warm if configured).
            method: "GET",
            pattern: "/v1/ready",
            handler: ({ res }) => {
                const poolReady = !pool || pool.available > 0 || sessionManager.size > 0;
                if (poolReady) {
                    json(res, 200, { status: "ready", poolAvailable: pool ? pool.available : null });
                }
                else {
                    json(res, 503, { status: "not_ready", poolAvailable: pool ? pool.available : null });
                }
            },
        },
        {
            method: "GET",
            pattern: "/v1/metrics",
            handler: ({ res }) => {
                json(res, 200, { ...metrics, activeSessions: sessionManager.size, uptime: process.uptime(), endpoints: snapshot() });
            },
        },
        {
            method: "GET",
            pattern: "/v1/docs",
            handler: ({ res }) => {
                json(res, 200, {
                    version: "1.0.0",
                    endpoints: 30,
                    categories: {
                        sessions: [
                            { method: "POST", path: "/v1/sessions", description: "Create a new browser session" },
                            { method: "GET", path: "/v1/sessions", description: "Get active session info" },
                            { method: "GET", path: "/v1/sessions/:id", description: "Get specific session details" },
                            { method: "GET", path: "/v1/sessions/list", description: "List all sessions" },
                            { method: "POST", path: "/v1/sessions/:id/release", description: "Destroy a session" },
                        ],
                        actions: [
                            { method: "POST", path: "/v1/actions/navigate", description: "Navigate to URL" },
                            { method: "POST", path: "/v1/actions/click", description: "Click element by selector" },
                            { method: "POST", path: "/v1/actions/type", description: "Type text into element" },
                            { method: "POST", path: "/v1/actions/select", description: "Select option(s) in dropdown" },
                            { method: "POST", path: "/v1/actions/hover", description: "Hover over element" },
                            { method: "POST", path: "/v1/actions/wait", description: "Wait for selector to appear" },
                            { method: "POST", path: "/v1/actions/evaluate", description: "Execute JavaScript in page" },
                            { method: "POST", path: "/v1/actions/upload", description: "Upload file to input element" },
                        ],
                        content: [
                            { method: "POST", path: "/v1/scrape", description: "Scrape page content (html/text)" },
                            { method: "POST", path: "/v1/pdf", description: "Generate PDF from page" },
                            { method: "GET", path: "/v1/screenshot", description: "Capture page screenshot" },
                            { method: "GET", path: "/v1/cookies", description: "Get all cookies" },
                            { method: "POST", path: "/v1/cookies", description: "Set cookies" },
                        ],
                        network: [
                            { method: "POST", path: "/v1/har/start", description: "Start HAR recording" },
                            { method: "POST", path: "/v1/har/stop", description: "Stop HAR recording" },
                            { method: "GET", path: "/v1/har", description: "Get HAR entries" },
                            { method: "POST", path: "/v1/intercept", description: "Enable/disable request interception" },
                        ],
                        recording: [
                            { method: "POST", path: "/v1/recording/start", description: "Start action recording" },
                            { method: "POST", path: "/v1/recording/stop", description: "Stop action recording" },
                            { method: "GET", path: "/v1/recording", description: "Get recorded actions" },
                        ],
                        files: [
                            { method: "GET", path: "/v1/downloads", description: "List downloaded files" },
                            { method: "GET", path: "/v1/downloads/:filename", description: "Download a file" },
                        ],
                        observability: [
                            { method: "GET", path: "/v1/health", description: "Health check" },
                            { method: "GET", path: "/v1/metrics", description: "Operational metrics" },
                            { method: "GET", path: "/v1/docs", description: "API documentation" },
                        ],
                    },
                });
            },
        },
    ];
}
