import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, readBody, resolveSession } from "../http-utils.js";

const BLOCKED_PROTOCOL = /^(file|javascript|data):/i;

export function contentRoutes(deps: Deps): Route[] {
  const { sessionManager, actions } = deps;

  return [
    {
      method: "POST",
      pattern: "/v1/scrape",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.url || typeof body.url !== "string") {
          json(res, 400, { error: "body.url must be a non-empty string" });
          return;
        }
        if (BLOCKED_PROTOCOL.test(body.url)) {
          json(res, 400, { error: "Blocked protocol: only http/https allowed" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const result = await actions.scrape(session, {
          url: body.url,
          waitForSelector: body.waitForSelector,
          format: body.format,
        });
        json(res, 200, result);
      },
    },
    {
      method: "POST",
      pattern: "/v1/pdf",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (body.url && BLOCKED_PROTOCOL.test(body.url)) {
          json(res, 400, { error: "Blocked protocol: only http/https allowed" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const pdf = await actions.pdf(session, { url: body.url, format: body.format, landscape: body.landscape, waitUntil: body.waitUntil, timeout: body.timeout });
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end(pdf);
      },
    },
    {
      method: "GET",
      pattern: "/v1/screenshot",
      handler: async ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const fullPage = url.searchParams.get("fullPage") === "true";
        const screenshot = await actions.screenshot(session, fullPage);
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(screenshot);
      },
    },
    {
      method: "GET",
      pattern: "/v1/cookies",
      handler: async ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const cookies = await actions.getCookies(session);
        json(res, 200, { cookies });
      },
    },
    {
      method: "POST",
      pattern: "/v1/cookies",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        if (!Array.isArray(body.cookies)) {
          json(res, 400, { error: "body.cookies must be an array" });
          return;
        }
        const injected = await actions.setCookies(session, body.cookies);
        json(res, 200, { injected });
      },
    },
  ];
}
