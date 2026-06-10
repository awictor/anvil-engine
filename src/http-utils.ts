import type { IncomingMessage, ServerResponse } from "node:http";
import { type Session, type SessionManager } from "./session.js";

export function json(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export type ResolveResult =
  | { session: Session; error?: never }
  | { session?: never; error: { status: number; body: { error: string } } };

export function resolveSession(sessionManager: SessionManager, req: IncomingMessage, url: URL): ResolveResult {
  const explicitId = (req.headers["x-session-id"] as string) || url.searchParams.get("sessionId") || "";
  if (explicitId) {
    const session = sessionManager.get(explicitId);
    if (!session) return { error: { status: 404, body: { error: "Session not found" } } };
    return { session };
  }
  const session = sessionManager.getActive();
  if (!session) return { error: { status: 400, body: { error: "No active session" } } };
  return { session };
}
