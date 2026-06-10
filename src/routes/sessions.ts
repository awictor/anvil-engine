import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, readBody } from "../http-utils.js";
import { generateFingerprintScript } from "../fingerprint.js";
import { fireWebhook } from "../webhooks.js";
import { counters as metrics } from "../metrics.js";

export function sessionRoutes(deps: Deps): Route[] {
  const { sessionManager, actions, config } = deps;
  const wsUrl = (id: string) => `ws://localhost:${config.port}/cdp?session=${id}`;

  return [
    {
      method: "POST",
      pattern: "/v1/sessions",
      handler: async ({ req, res }) => {
        const body = await readBody(req);
        const options = body ? JSON.parse(body) : {};
        if (options.userDataDir && (options.userDataDir.includes("..") || /[\r\n\0]/.test(options.userDataDir))) {
          json(res, 400, { error: "Invalid userDataDir" });
          return;
        }
        if (sessionManager.size >= config.maxSessions) {
          json(res, 503, { error: `Max sessions reached (${config.maxSessions})` });
          return;
        }
        const session = await sessionManager.create({
          headless: options.headless,
          width: options.dimensions?.width,
          height: options.dimensions?.height,
          proxy: options.proxyUrl,
          userDataDir: options.userDataDir,
          stealth: options.stealth,
          userAgent: options.userAgent,
        });

        const width = options.dimensions?.width || 1920;
        const height = options.dimensions?.height || 1080;
        const stealthEnabled = options.stealth !== false;
        await actions.applySessionDefaults(session, {
          userAgent: options.userAgent,
          width,
          height,
          fingerprintScript: stealthEnabled ? generateFingerprintScript(session.id) : undefined,
        });

        json(res, 201, {
          id: session.id,
          status: session.status,
          websocketUrl: wsUrl(session.id),
          cdpPort: session.browserProcess.cdpPort,
          dimensions: { width, height },
          userAgent: session.options.userAgent || null,
          fingerprint: stealthEnabled,
          createdAt: new Date(session.createdAt).toISOString(),
        });
        fireWebhook("session.created", session.id);
        metrics.sessionsCreated++;
        metrics.peakConcurrent = Math.max(metrics.peakConcurrent, sessionManager.size);
      },
    },
    {
      method: "GET",
      pattern: "/v1/sessions",
      handler: ({ res }) => {
        const active = sessionManager.getActive();
        if (active) {
          const idleMs = Date.now() - active.lastActivityAt;
          json(res, 200, {
            id: active.id,
            status: active.status,
            websocketUrl: wsUrl(active.id),
            cdpPort: active.browserProcess.cdpPort,
            createdAt: new Date(active.createdAt).toISOString(),
            timeoutMs: config.sessionTimeoutMs,
            idleMs,
            expiresAt: config.sessionTimeoutMs > 0
              ? new Date(active.lastActivityAt + config.sessionTimeoutMs).toISOString()
              : null,
          });
        } else {
          json(res, 200, { id: null, status: "idle" });
        }
      },
    },
    {
      // Registered before /v1/sessions/:id — order preserves original precedence.
      method: "GET",
      pattern: "/v1/sessions/list",
      handler: ({ res }) => {
        json(res, 200, { sessions: sessionManager.list(), count: sessionManager.size });
      },
    },
    {
      method: "GET",
      pattern: "/v1/sessions/:id",
      handler: ({ res, params }) => {
        const session = sessionManager.get(params.id);
        if (!session) {
          json(res, 404, { error: "Session not found" });
          return;
        }
        const idleMs = Date.now() - session.lastActivityAt;
        json(res, 200, {
          id: session.id,
          status: session.status,
          websocketUrl: wsUrl(session.id),
          cdpPort: session.browserProcess.cdpPort,
          dimensions: { width: session.options.width || 1920, height: session.options.height || 1080 },
          userAgent: session.options.userAgent || null,
          createdAt: new Date(session.createdAt).toISOString(),
          timeoutMs: config.sessionTimeoutMs,
          idleMs,
          expiresAt: config.sessionTimeoutMs > 0
            ? new Date(session.lastActivityAt + config.sessionTimeoutMs).toISOString()
            : null,
        });
      },
    },
    {
      method: "POST",
      pattern: "/v1/sessions/:id/release",
      handler: async ({ res, params }) => {
        const session = await sessionManager.destroy(params.id);
        if (session) {
          json(res, 200, { id: session.id, status: "released", duration: Date.now() - session.createdAt });
          fireWebhook("session.released", session.id);
          metrics.sessionsReleased++;
        } else {
          json(res, 404, { error: "Session not found" });
        }
      },
    },
  ];
}
