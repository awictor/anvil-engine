import { writeFileSync, unlinkSync } from "node:fs";
import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, readBody, resolveSession } from "../http-utils.js";
import { safeJoin } from "../path-safety.js";

const BLOCKED_PROTOCOL = /^(file|javascript|data):/i;

export function actionRoutes(deps: Deps): Route[] {
  const { sessionManager, actions } = deps;

  return [
    {
      method: "POST",
      pattern: "/v1/actions/navigate",
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

        const t0 = Date.now();
        const result = await actions.navigate(session, { url: body.url, waitUntil: body.waitUntil, timeout: body.timeout });
        actions.recordAction(session.id, "navigate", { url: body.url, waitUntil: body.waitUntil }, Date.now() - t0);
        json(res, 200, result);
      },
    },
    {
      method: "POST",
      pattern: "/v1/actions/click",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.selector || typeof body.selector !== "string") {
          json(res, 400, { error: "body.selector must be a non-empty string" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const t0 = Date.now();
        await actions.click(session, { selector: body.selector, button: body.button, clickCount: body.clickCount });
        actions.recordAction(session.id, "click", { selector: body.selector, button: body.button, clickCount: body.clickCount }, Date.now() - t0);
        json(res, 200, { success: true, selector: body.selector });
      },
    },
    {
      method: "POST",
      pattern: "/v1/actions/type",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.selector || typeof body.selector !== "string") {
          json(res, 400, { error: "body.selector must be a non-empty string" });
          return;
        }
        if (!body.text || typeof body.text !== "string") {
          json(res, 400, { error: "body.text must be a non-empty string" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        await actions.type(session, { selector: body.selector, text: body.text, delay: body.delay });
        json(res, 200, { success: true, selector: body.selector });
      },
    },
    {
      method: "POST",
      pattern: "/v1/actions/select",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.selector || typeof body.selector !== "string") {
          json(res, 400, { error: "body.selector must be a non-empty string" });
          return;
        }
        if (!Array.isArray(body.values)) {
          json(res, 400, { error: "body.values must be an array of strings" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const selected = await actions.select(session, { selector: body.selector, values: body.values });
        json(res, 200, { success: true, selector: body.selector, selected });
      },
    },
    {
      method: "POST",
      pattern: "/v1/actions/hover",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.selector || typeof body.selector !== "string") {
          json(res, 400, { error: "body.selector must be a non-empty string" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        await actions.hover(session, body.selector);
        json(res, 200, { success: true, selector: body.selector });
      },
    },
    {
      method: "POST",
      pattern: "/v1/actions/wait",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.selector || typeof body.selector !== "string") {
          json(res, 400, { error: "body.selector must be a non-empty string" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        await actions.wait(session, { selector: body.selector, timeout: body.timeout });
        json(res, 200, { success: true, selector: body.selector });
      },
    },
    {
      method: "POST",
      pattern: "/v1/actions/upload",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.selector || typeof body.selector !== "string") {
          json(res, 400, { error: "body.selector must be a non-empty string" });
          return;
        }
        if (!body.filename || typeof body.filename !== "string") {
          json(res, 400, { error: "body.filename must be a non-empty string" });
          return;
        }
        if (!body.data || typeof body.data !== "string") {
          json(res, 400, { error: "body.data must be a non-empty base64 string" });
          return;
        }
        const decoded = Buffer.from(body.data, "base64");
        if (decoded.length > 10_485_760) {
          json(res, 400, { error: "File data exceeds 10MB limit" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const dir = session.browserProcess.downloadDir;
        if (!dir) { json(res, 500, { error: "No temp directory available" }); return; }

        const tempPath = safeJoin(dir, body.filename);
        if (!tempPath) {
          json(res, 400, { error: "Invalid filename" });
          return;
        }
        writeFileSync(tempPath, decoded);
        try {
          await actions.upload(session, { selector: body.selector, tempPath });
          json(res, 200, { success: true, selector: body.selector, filename: body.filename });
        } finally {
          try { unlinkSync(tempPath); } catch {}
        }
      },
    },
    {
      method: "POST",
      pattern: "/v1/actions/evaluate",
      handler: async ({ req, res, url }) => {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body.script || typeof body.script !== "string") {
          json(res, 400, { error: "body.script must be a non-empty string" });
          return;
        }
        if (body.script.length > 100_000) {
          json(res, 400, { error: "body.script exceeds 100KB limit" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        const result = await actions.evaluate(session, body.script);
        json(res, 200, result);
      },
    },
  ];
}
