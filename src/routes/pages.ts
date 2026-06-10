import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, readBody, resolveSession } from "../http-utils.js";

const BLOCKED_PROTOCOL = /^(file|javascript|data):/i;

export function pageRoutes(deps: Deps): Route[] {
  const { sessionManager, actions } = deps;

  return [
    {
      method: "GET",
      pattern: "/v1/pages",
      handler: async ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const pages = await actions.listPages(session);
        json(res, 200, { pages });
      },
    },
    {
      method: "POST",
      pattern: "/v1/pages",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (body.url !== undefined && typeof body.url !== "string") {
          json(res, 400, { error: "body.url must be a string" });
          return;
        }
        if (body.url && BLOCKED_PROTOCOL.test(body.url)) {
          json(res, 400, { error: "Blocked protocol: only http/https allowed" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const result = await actions.openPage(session, body.url);
        json(res, 200, result);
      },
    },
    {
      method: "DELETE",
      pattern: "/v1/pages/:index",
      handler: async ({ req, res, url, params }) => {
        const index = Number(params.index);
        if (!Number.isInteger(index) || index < 0) {
          json(res, 400, { error: "page index must be a non-negative integer" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const result = await actions.closePage(session, index);
        json(res, 200, result);
      },
    },
  ];
}
