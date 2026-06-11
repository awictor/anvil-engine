import type { ServerResponse } from "node:http";
import { type Route } from "../router.js";
import { type Deps } from "./deps.js";
import { json, resolveSession } from "../http-utils.js";

const STREAM_BOUNDARY = "frame";
const FPS_DEFAULT = 2;
const FPS_MIN = 1;
const FPS_MAX = 10;

/**
 * Writes one chunk respecting backpressure: when the socket buffer is full,
 * waits for drain (or close) before reporting. Returns false once the client
 * is gone so the stream loop can stop capturing.
 */
function writeChunk(res: ServerResponse, chunk: Uint8Array): Promise<boolean> {
  if (res.destroyed || res.writableEnded) return Promise.resolve(false);
  if (res.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onDrain = () => { cleanup(); resolve(true); };
    const onClose = () => { cleanup(); resolve(false); };
    const cleanup = () => { res.off("drain", onDrain); res.off("close", onClose); };
    res.once("drain", onDrain);
    res.once("close", onClose);
  });
}

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
    {
      method: "GET",
      pattern: "/v1/view/stream",
      handler: async ({ req, res, url }) => {
        const rawQuality = url.searchParams.get("quality");
        const quality = rawQuality !== null ? Number(rawQuality) : undefined;
        if (rawQuality !== null && !Number.isFinite(quality)) {
          json(res, 400, { error: "quality must be a number" });
          return;
        }
        const rawFps = url.searchParams.get("fps");
        const fpsInput = rawFps !== null ? Number(rawFps) : FPS_DEFAULT;
        if (!Number.isFinite(fpsInput)) {
          json(res, 400, { error: "fps must be a number" });
          return;
        }
        const fps = Math.max(FPS_MIN, Math.min(FPS_MAX, fpsInput));
        const { session, error } = resolveSession(sessionManager, req, url);
        if (error) { json(res, error.status, error.body); return; }

        res.writeHead(200, {
          "Content-Type": `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`,
          "Cache-Control": "no-cache, no-store",
          Connection: "close",
        });

        let clientGone = false;
        const onClose = () => { clientGone = true; };
        res.once("close", onClose);

        // Each frame is an independent captureFrame call, so the in-flight
        // refcount is held per frame — never across the whole stream. A
        // session destroy drains between frames and the next capture throws,
        // ending the stream cleanly.
        const intervalMs = 1000 / fps;
        while (!clientGone) {
          const startedAt = Date.now();
          let frame: Uint8Array;
          try {
            frame = await actions.captureFrame(session, quality);
          } catch {
            break; // session destroyed or browser unrecoverable — end stream
          }
          const part = Buffer.concat([
            Buffer.from(`--${STREAM_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`),
            frame,
            Buffer.from("\r\n"),
          ]);
          if (!(await writeChunk(res, part))) break;
          // A watched session counts as active — keep the idle timer reset.
          sessionManager.touch(session.id);
          const waitMs = intervalMs - (Date.now() - startedAt);
          if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
        }
        res.off("close", onClose);
        if (!res.writableEnded) res.end();
      },
    },
  ];
}
