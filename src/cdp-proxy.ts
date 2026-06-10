import { WebSocketServer, WebSocket } from "ws";
import { type IncomingMessage } from "node:http";
import { type Server } from "node:http";
import { type SessionManager } from "./session.js";

export function createCdpProxy(server: Server, sessionManager: SessionManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/cdp" });
  const apiKey = process.env.ANVIL_API_KEY || "";
  const requireAuth = process.env.ANVIL_REQUIRE_CDP_AUTH === "true";

  if (!apiKey) {
    process.stderr.write(
      requireAuth
        ? "[anvil-engine] WARNING: ANVIL_REQUIRE_CDP_AUTH=true but no ANVIL_API_KEY set — all CDP connections will be rejected\n"
        : "[anvil-engine] WARNING: CDP proxy running without authentication (no ANVIL_API_KEY set)\n",
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

    chromeWs.on("open", () => {
      // Relay messages bidirectionally
      clientWs.on("message", (data) => {
        if (chromeWs.readyState === WebSocket.OPEN) {
          chromeWs.send(data);
        }
      });

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
