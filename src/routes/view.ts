import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, resolveSession } from "../http-utils.js";

export function viewRoutes(deps: Deps): Route[] {
  const { sessionManager, actions } = deps;

  return [
    {
      method: "GET",
      pattern: "/v1/view",
      handler: async ({ req, res, url }) => {
        const rawQuality = url.searchParams.get("quality");
        const quality = rawQuality !== null ? Number(rawQuality) : undefined;
        if (rawQuality !== null && !Number.isFinite(quality)) {
          json(res, 400, { error: "quality must be a number" });
          return;
        }
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        // captureFrame clamps quality to 1-100.
        const frame = await actions.captureFrame(session, quality);
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        res.end(frame);
      },
    },
  ];
}
