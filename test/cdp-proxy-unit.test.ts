import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { createCdpProxy } from "../src/cdp-proxy.js";
import { SessionManager } from "../src/session.js";

// Real WebSocket integration tests against the CDP proxy — no Chrome needed
// for the auth/validation paths (they fail before dialing Chrome).

const savedKey = process.env.ANVIL_API_KEY;
const savedRequire = process.env.ANVIL_REQUIRE_CDP_AUTH;

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANVIL_API_KEY;
  else process.env.ANVIL_API_KEY = savedKey;
  if (savedRequire === undefined) delete process.env.ANVIL_REQUIRE_CDP_AUTH;
  else process.env.ANVIL_REQUIRE_CDP_AUTH = savedRequire;
});

interface ProxyHarness {
  port: number;
  close: () => void;
}

function startProxy(): Promise<ProxyHarness> {
  const server = createServer();
  const sessionManager = new SessionManager();
  const wss = createCdpProxy(server, sessionManager);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => {
          wss.close();
          server.close();
        },
      });
    });
  });
}

function expectClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket did not close within 3s")), 3000);
    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.on("error", () => {});
  });
}

describe("cdp-proxy", () => {
  it("closes 4000 when session param is missing (dev mode)", async () => {
    delete process.env.ANVIL_API_KEY;
    delete process.env.ANVIL_REQUIRE_CDP_AUTH;
    const proxy = await startProxy();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/cdp`);
      const { code, reason } = await expectClose(ws);
      expect(code).toBe(4000);
      expect(reason).toContain("session");
    } finally {
      proxy.close();
    }
  });

  it("closes 4004 for unknown session (dev mode)", async () => {
    delete process.env.ANVIL_API_KEY;
    delete process.env.ANVIL_REQUIRE_CDP_AUTH;
    const proxy = await startProxy();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/cdp?session=ghost`);
      const { code } = await expectClose(ws);
      expect(code).toBe(4004);
    } finally {
      proxy.close();
    }
  });

  it("closes 4001 when key is set and token missing", async () => {
    process.env.ANVIL_API_KEY = "proxy-secret";
    const proxy = await startProxy();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/cdp?session=anything`);
      const { code, reason } = await expectClose(ws);
      expect(code).toBe(4001);
      expect(reason).toContain("Unauthorized");
    } finally {
      proxy.close();
    }
  });

  it("closes 4001 when key is set and token wrong", async () => {
    process.env.ANVIL_API_KEY = "proxy-secret";
    const proxy = await startProxy();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/cdp?session=x&token=wrong`);
      const { code } = await expectClose(ws);
      expect(code).toBe(4001);
    } finally {
      proxy.close();
    }
  });

  it("with correct token proceeds past auth to session lookup (4004)", async () => {
    process.env.ANVIL_API_KEY = "proxy-secret";
    const proxy = await startProxy();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/cdp?session=ghost&token=proxy-secret`);
      const { code } = await expectClose(ws);
      expect(code).toBe(4004); // auth passed, session not found
    } finally {
      proxy.close();
    }
  });

  it("ANVIL_REQUIRE_CDP_AUTH=true rejects all connections when no key configured", async () => {
    delete process.env.ANVIL_API_KEY;
    process.env.ANVIL_REQUIRE_CDP_AUTH = "true";
    const proxy = await startProxy();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/cdp?session=x&token=anything`);
      const { code } = await expectClose(ws);
      expect(code).toBe(4001);
    } finally {
      proxy.close();
    }
  });
});
