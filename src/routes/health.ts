import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json } from "../http-utils.js";
import { counters as metrics, snapshot } from "../metrics.js";

export function healthRoutes(deps: Deps): Route[] {
  const { sessionManager, pool, config } = deps;

  return [
    {
      method: "GET",
      pattern: "/v1/health",
      handler: ({ res }) => {
        json(res, 200, {
          status: "ok",
          sessions: sessionManager.size,
          // Capacity (m17 anvil-ops-2): activeSessions alone doesn't tell an operator how close to
          // exhaustion we are — new sessions get rejected once maxSessions is hit. Expose the
          // ceiling + warm-pool depth so `relay status` / any operator can gauge headroom.
          maxSessions: config.maxSessions,
          poolSize: config.poolSize,
          poolAvailable: pool ? pool.available : 0,
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
        } else {
          json(res, 503, { status: "not_ready", poolAvailable: pool ? pool.available : null });
        }
      },
    },
    {
      method: "GET",
      pattern: "/v1/metrics",
      handler: ({ res }) => {
        const life = sessionManager.lifecycleStats(Date.now());
        json(res, 200, {
          ...metrics,
          activeSessions: sessionManager.size,
          // Capacity ceiling + warm-pool depth (m17 anvil-ops-2) so a scrape/monitor can alert on
          // session exhaustion, not just count what's active.
          maxSessions: config.maxSessions,
          poolSize: config.poolSize,
          poolAvailable: pool ? pool.available : 0,
          // Lifecycle leak signals (DEV-0158): a session stuck at inFlight>0 is un-reapable, and a
          // growing oldest-age/idle is an early starvation warning before the pool runs dry.
          inFlightTotal: life.inFlightTotal,
          oldestSessionAgeMs: life.oldestAgeMs,
          oldestSessionIdleMs: life.oldestIdleMs,
          uptime: process.uptime(),
          endpoints: snapshot(),
        });
      },
    },
    {
      method: "GET",
      pattern: "/v1/docs",
      handler: ({ res }) => {
        json(res, 200, {
          version: "1.0.0",
          endpoints: 38,
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
              { method: "GET", path: "/v1/view", description: "Capture a single JPEG frame (live view)" },
              { method: "GET", path: "/v1/view/stream", description: "MJPEG live view stream (optional ?fps=, ?quality=)" },
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
            pages: [
              { method: "GET", path: "/v1/pages", description: "List open pages in the session" },
              { method: "POST", path: "/v1/pages", description: "Open a new page (optional url)" },
              { method: "DELETE", path: "/v1/pages/:index", description: "Close the page at index" },
            ],
            contexts: [
              { method: "GET", path: "/v1/contexts", description: "List isolated browser contexts" },
              { method: "POST", path: "/v1/contexts", description: "Create an isolated browser context" },
              { method: "DELETE", path: "/v1/contexts/:id", description: "Close a browser context" },
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
