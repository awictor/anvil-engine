import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, resolveSession } from "../http-utils.js";

export function recordingRoutes(deps: Deps): Route[] {
  const { sessionManager, actions } = deps;

  return [
    {
      method: "POST",
      pattern: "/v1/recording/start",
      handler: ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        actions.startRecording(session);
        json(res, 200, { recording: true, sessionId: session.id });
      },
    },
    {
      method: "POST",
      pattern: "/v1/recording/stop",
      handler: ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const entries = actions.stopRecording(session);
        json(res, 200, { recording: false, actions: entries.length });
      },
    },
    {
      method: "GET",
      pattern: "/v1/recording",
      handler: ({ req, res, url }) => {
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }
        const { recording, actions: recorded } = actions.getRecording(session);
        json(res, 200, { recording, actions: recorded });
      },
    },
  ];
}
