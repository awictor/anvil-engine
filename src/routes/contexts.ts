import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, resolveSession } from "../http-utils.js";

export function contextRoutes(deps: Deps): Route[] {
  const { sessionManager, actions } = deps;

  return [
    {
      method: "GET",
      pattern: "/v1/contexts",
      handler: ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        json(res, 200, actions.listContexts(session));
      },
    },
    {
      method: "POST",
      pattern: "/v1/contexts",
      handler: async ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const result = await actions.createContext(session);
        json(res, 200, result);
      },
    },
    {
      method: "DELETE",
      pattern: "/v1/contexts/:id",
      handler: async ({ req, res, url, params }) => {
        if (!params.id) {
          json(res, 400, { error: "context id is required" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const result = await actions.closeContext(session, params.id);
        json(res, 200, result);
      },
    },
  ];
}
