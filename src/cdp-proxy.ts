import { WebSocketServer, WebSocket } from "ws";
import { type IncomingMessage } from "node:http";
import { type Server } from "node:http";
import { type SessionManager } from "./session.js";
import { createLogger } from "./logger.js";

const logger = createLogger("cdp-proxy");

export function createCdpProxy(server: Server, sessionManager: SessionManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/cdp" });
  const apiKey = process.env.ANVIL_API_KEY || "";
  const requireAuth = process.env.ANVIL_REQUIRE_CDP_AUTH === "true";

  if (!apiKey) {
    logger.warn(
      requireAuth
        ? "ANVIL_REQUIRE_CDP_AUTH=true but no ANVIL_API_KEY set — all CDP connections will be rejected"
        : "CDP proxy running without authentication (no ANVIL_API_KEY set)",
    );
  }

  wss.on("connection", (clientWs: WebSocket, req: IncomingMessage) => {
    const params = new URL(req.url || "/", "http://localhost").searchParams;

    if (apiKey || requireAuth) {
      const token = params.get("token");
      if (!apiKey || typeof token !== "string" || token.length === 0 || token !== apiKey) {
        clientWs.close(4001, "Unauthorized: invalid or missing ?token= parameter");
        return;
      }
    }

    const sessionId = params.get("session");
    if (!sessionId) {
      clientWs.close(4000, "Missing ?session= parameter");
      return;
    }

    const session = sessionManager.get(sessionId);
    if (!session) {
      clientWs.close(4004, `Session ${sessionId} not found`);
      return;
    }

    const targetUrl = session.browserProcess.wsEndpoint;

    // Connect to Chrome's CDP WebSocket
    const chromeWs = new WebSocket(targetUrl);

    // Puppeteer sends its first CDP commands (Target.getBrowserContexts,
    // Target.setDiscoverTargets) immediately on connect — often BEFORE chromeWs
    // finishes opening. Buffer any client messages that arrive pre-open and flush
    // them on open, so those early commands aren't dropped (which caused
    // "Protocol error (Target.getBrowserContexts): Target closed").
    const preOpenBuffer: Array<Buffer | ArrayBuffer | Buffer[]> = [];

    // Client -> Chrome: attach the listener NOW (buffer until chrome is open).
    clientWs.on("message", (data) => {
      if (chromeWs.readyState === WebSocket.OPEN) {
        chromeWs.send(data);
      } else {
        preOpenBuffer.push(data as Buffer);
      }
    });

    chromeWs.on("open", () => {
      // Flush anything the client sent before Chrome was ready.
      for (const data of preOpenBuffer) {
        if (chromeWs.readyState === WebSocket.OPEN) chromeWs.send(data);
      }
      preOpenBuffer.length = 0;

      // Chrome -> client.
      chromeWs.on("message", (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });
    });

    chromeWs.on("error", (err) => {
      clientWs.close(4500, `Chrome CDP error: ${err.message}`);
    });

    chromeWs.on("close", () => {
      clientWs.close(4001, "Chrome CDP connection closed");
    });

    clientWs.on("close", () => {
      chromeWs.close();
    });

    clientWs.on("error", () => {
      chromeWs.close();
    });
  });

  return wss;
}
