import { createServer, type Server } from "node:http";
import { SessionManager } from "./session.js";
import { SessionActions } from "./actions.js";
import { createCdpProxy } from "./cdp-proxy.js";
import { BrowserPool } from "./pool.js";
import { RateLimiter } from "./rate-limiter.js";
import { type Config } from "./config.js";
import { createLogger } from "./logger.js";
import { recordRequest } from "./metrics.js";
import { Router } from "./router.js";
import { corsMiddleware, rateLimitMiddleware, authMiddleware, errorToResponse, type Middleware } from "./middleware.js";
import { json } from "./http-utils.js";
import { type Deps } from "./routes/deps.js";
import { sessionRoutes } from "./routes/sessions.js";
import { actionRoutes } from "./routes/actions.js";
import { contentRoutes } from "./routes/content.js";
import { networkRoutes } from "./routes/network.js";
import { recordingRoutes } from "./routes/recording.js";
import { downloadRoutes } from "./routes/downloads.js";
import { healthRoutes } from "./routes/health.js";

const logger = createLogger("app");

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

export function buildApp(config: Config): App {
  const pool = config.poolSize > 0 ? new BrowserPool(config.poolSize) : undefined;
  const sessionManager = new SessionManager(pool);
  const rateLimiter = config.rateLimitRpm > 0 ? new RateLimiter(config.rateLimitRpm) : null;
  const actions = new SessionActions(sessionManager, {
    evaluateTimeoutMs: config.evaluateTimeoutMs,
    harMaxEntries: config.harMaxEntries,
  });

  const deps: Deps = { sessionManager, actions, pool, config };

  // Registration order is dispatch order — sessions before generic :id
  // patterns, /v1/downloads before /v1/downloads/*filename.
  const router = new Router();
  router.addAll(sessionRoutes(deps));
  router.addAll(actionRoutes(deps));
  router.addAll(contentRoutes(deps));
  router.addAll(networkRoutes(deps));
  router.addAll(recordingRoutes(deps));
  router.addAll(downloadRoutes(deps));
  router.addAll(healthRoutes(deps));

  // Order is load-bearing: CORS (+ OPTIONS short-circuit) -> rate limit -> auth.
  const middlewares: Middleware[] = [
    corsMiddleware(),
    rateLimitMiddleware(rateLimiter),
    authMiddleware(config.apiKey),
  ];

  let requestCounter = 0;
  const server = createServer(async (req, res) => {
    const startTime = Date.now();
    const requestId = `req-${++requestCounter}`;
    res.setHeader("X-Request-Id", requestId);

    let url: URL;
    try {
      url = new URL(req.url || "/", `http://localhost:${config.port}`);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Malformed URL" }));
      return;
    }
    const method = req.method || "GET";

    res.on("finish", () => {
      if (method !== "OPTIONS") {
        const durationMs = Date.now() - startTime;
        recordRequest(method, url.pathname, res.statusCode, durationMs);
        logger.info("request", { requestId, method, path: url.pathname, status: res.statusCode, durationMs });
      }
    });

    for (const middleware of middlewares) {
      if (!middleware(req, res, url)) return;
    }

    // Touch targeted/active session to reset idle timeout
    const explicitId = (req.headers["x-session-id"] as string) || url.searchParams.get("sessionId") || "";
    const touched = explicitId ? sessionManager.get(explicitId) : sessionManager.getActive();
    if (touched) sessionManager.touch(touched.id);

    try {
      const match = router.match(method, url.pathname);
      if (!match) {
        json(res, 404, { error: "Not found" });
        return;
      }
      await match.handler({ req, res, url, params: match.params, requestId });
    } catch (err: unknown) {
      const { status, body } = errorToResponse(err);
      json(res, status, body);
    }
  });

  createCdpProxy(server, sessionManager);

  return {
    server,
    sessionManager,
    actions,
    pool,
    rateLimiter,
    config,
    async start() {
      if (pool) {
        logger.info(`Pre-warming ${config.poolSize} browser instances`);
        await pool.init();
        logger.info("Pool ready", { warmInstances: pool.available });
      }
      sessionManager.startCleanup(config.sessionTimeoutMs);
      if (rateLimiter) rateLimiter.startCleanup();
    },
    async stop() {
      server.close();
      sessionManager.stopCleanup();
      if (rateLimiter) rateLimiter.stopCleanup();
      await sessionManager.destroyAll();
      if (pool) await pool.shutdown();
    },
  };
}
