import { readdirSync, statSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, resolveSession } from "../http-utils.js";
import { safeJoin } from "../path-safety.js";

export function downloadRoutes(deps: Deps): Route[] {
  const { sessionManager } = deps;

  return [
    {
      method: "GET",
      pattern: "/v1/downloads",
      handler: ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const dir = session.browserProcess.downloadDir;
        if (!dir) { json(res, 200, { files: [] }); return; }

        try {
          const entries = readdirSync(dir);
          const files = entries.map((name) => {
            const st = statSync(join(dir, name));
            return { name, size: st.size, createdAt: st.birthtime.toISOString() };
          });
          json(res, 200, { files });
        } catch {
          json(res, 200, { files: [] });
        }
      },
    },
    {
      // Registered after /v1/downloads — rest-capture preserves original precedence.
      method: "GET",
      pattern: "/v1/downloads/*filename",
      handler: ({ req, res, url, params }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const dir = session.browserProcess.downloadDir;
        if (!dir) { json(res, 404, { error: "No download directory" }); return; }

        const filename = decodeURIComponent(params.filename);
        const filePath = safeJoin(dir, filename);
        if (!filePath) {
          json(res, 400, { error: "Invalid filename" });
          return;
        }
        try {
          const st = statSync(filePath);
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": st.size.toString(),
          });
          createReadStream(filePath).pipe(res);
        } catch {
          json(res, 404, { error: "File not found" });
        }
      },
    },
  ];
}
