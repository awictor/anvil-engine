import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, readBody, resolveSession } from "../http-utils.js";

export function networkRoutes(deps: Deps): Route[] {
  const { sessionManager, actions } = deps;

  return [
    {
      method: "POST",
      pattern: "/v1/har/start",
      handler: async ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        await actions.startHar(session);
        json(res, 200, { recording: true });
      },
    },
    {
      method: "POST",
      pattern: "/v1/har/stop",
      handler: ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const entries = actions.stopHar(session);
        json(res, 200, { recording: false, entries: entries.length });
      },
    },
    {
      method: "GET",
      pattern: "/v1/har",
      handler: ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        json(res, 200, { entries: actions.getHar(session) });
      },
    },
    {
      method: "POST",
      pattern: "/v1/intercept",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (typeof body.enabled !== "boolean") {
          json(res, 400, { error: "body.enabled must be a boolean" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const blockPatterns: string[] = (body.blockPatterns || []).filter(
          (p: unknown) => typeof p === "string" && p.length > 0,
        );
        await actions.setIntercept(session, body.enabled, blockPatterns);
        json(res, 200, body.enabled
          ? { enabled: true, blocking: blockPatterns.length }
          : { enabled: false, blocking: 0 });
      },
    },
  ];
}
