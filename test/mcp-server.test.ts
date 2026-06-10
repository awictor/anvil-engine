import { describe, it, expect } from "vitest";
import { buildMcpServer } from "../src/mcp/server.js";
import { createTools, type McpDeps } from "../src/mcp/tools.js";

// Verifies the MCP server wiring without binding stdio or launching Chrome.
// We feed a fake deps object into the tool registry, build the server, and
// exercise its registered tools/list + tools/call request handlers directly.

function fakeTools() {
  const calls: string[] = [];
  const deps = {
    sessionManager: {
      async create() {
        calls.push("create");
        return { id: "sess-1", status: "live", browserProcess: { cdpPort: 9222 } };
      },
      getActive() {
        return { id: "sess-1", status: "live", browserProcess: { cdpPort: 9222 } };
      },
      get() {
        return undefined;
      },
      async destroy(id: string) {
        calls.push(`destroy:${id}`);
        return { id, status: "released" };
      },
    },
    actions: {
      async navigate(_s: unknown, p: { url: string }) {
        calls.push(`navigate:${p.url}`);
        return { url: p.url, title: "T" };
      },
    },
  } as unknown as McpDeps;
  return { tools: createTools(deps), calls };
}

// The low-level Server keeps request handlers in a private map; we reach in to
// invoke them the way the transport would, with the schema's method string.
function getHandler(server: ReturnType<typeof buildMcpServer>, method: string) {
  const handlers = (server as unknown as { _requestHandlers: Map<string, Function> })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No handler registered for ${method}`);
  return handler;
}

describe("buildMcpServer", () => {
  it("returns a Server instance with tools/list and tools/call handlers", () => {
    const { tools } = fakeTools();
    const server = buildMcpServer(tools);
    const handlers = (server as unknown as { _requestHandlers: Map<string, Function> })._requestHandlers;
    expect(handlers.has("tools/list")).toBe(true);
    expect(handlers.has("tools/call")).toBe(true);
  });

  it("tools/list returns the registry's tools with names and schemas", async () => {
    const { tools } = fakeTools();
    const server = buildMcpServer(tools);
    const listHandler = getHandler(server, "tools/list");
    const result = await listHandler({ method: "tools/list", params: {} }, {});
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      "create_session",
      "navigate",
      "scrape",
      "screenshot",
      "click",
      "type",
      "evaluate",
      "get_cookies",
      "set_cookies",
      "list_pages",
      "open_page",
      "close_page",
      "release",
    ]);
    for (const t of result.tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("tools/call dispatches create_session to the registry handler", async () => {
    const { tools, calls } = fakeTools();
    const server = buildMcpServer(tools);
    const callHandler = getHandler(server, "tools/call");
    const result = await callHandler(
      { method: "tools/call", params: { name: "create_session", arguments: {} } },
      {},
    );
    expect(calls).toContain("create");
    expect(JSON.parse(result.content[0].text)).toMatchObject({ id: "sess-1" });
  });

  it("tools/call dispatches navigate with arguments", async () => {
    const { tools, calls } = fakeTools();
    const server = buildMcpServer(tools);
    const callHandler = getHandler(server, "tools/call");
    const result = await callHandler(
      { method: "tools/call", params: { name: "navigate", arguments: { url: "https://example.com" } } },
      {},
    );
    expect(calls).toContain("navigate:https://example.com");
    expect(JSON.parse(result.content[0].text)).toEqual({ url: "https://example.com", title: "T" });
  });

  it("tools/call returns an error result for an unknown tool", async () => {
    const { tools } = fakeTools();
    const server = buildMcpServer(tools);
    const callHandler = getHandler(server, "tools/call");
    const result = await callHandler(
      { method: "tools/call", params: { name: "frobnicate", arguments: {} } },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });
});
