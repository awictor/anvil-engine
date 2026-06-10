import { describe, it, expect } from "vitest";
import { createTools, dispatchTool, type McpDeps } from "../src/mcp/tools.js";

// Unit tests for the MCP tool layer. A fake SessionManager/SessionActions lets
// us verify dispatch + schemas without launching Chrome.

function makeDeps(overrides: Partial<{ active: unknown; sessions: Map<string, unknown> }> = {}): {
  deps: McpDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const sessions = overrides.sessions ?? new Map<string, unknown>();
  let active = overrides.active ?? null;

  const sessionManager = {
    async create() {
      calls.push("create");
      const session = { id: "sess-new", status: "live", browserProcess: { cdpPort: 9222 } };
      active = session;
      return session;
    },
    get(id: string) {
      calls.push(`get:${id}`);
      return sessions.get(id);
    },
    getActive() {
      calls.push("getActive");
      return active;
    },
    async destroy(id: string) {
      calls.push(`destroy:${id}`);
      return { id, status: "released" };
    },
  } as unknown as McpDeps["sessionManager"];

  const actions = {
    async navigate(_session: unknown, params: { url: string }) {
      calls.push(`navigate:${params.url}`);
      return { url: params.url, title: "Fake Title" };
    },
    async scrape(_session: unknown, params: { url: string; format?: string }) {
      calls.push(`scrape:${params.url}:${params.format ?? "text"}`);
      return { content: "Hello", title: "Fake Title", url: params.url };
    },
    async screenshot(_session: unknown, fullPage: boolean) {
      calls.push(`screenshot:${fullPage}`);
      // PNG magic bytes so the base64 is verifiable
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    },
  } as unknown as McpDeps["actions"];

  return { deps: { sessionManager, actions }, calls };
}

describe("MCP tool registry", () => {
  it("exposes the core tool set with names and schemas", () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["create_session", "navigate", "scrape", "screenshot", "release"]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeTypeOf("object");
    }
  });

  it("navigate marks url as required", () => {
    const { deps } = makeDeps();
    const navigate = createTools(deps).find((t) => t.name === "navigate")!;
    expect(navigate.inputSchema.required).toContain("url");
  });
});

describe("dispatchTool", () => {
  it("create_session calls SessionManager.create and returns id", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "create_session", { headless: true });
    expect(calls).toContain("create");
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "sess-new", status: "live" });
  });

  it("navigate resolves the active session and calls SessionActions.navigate", async () => {
    const { deps, calls } = makeDeps();
    // Seed an active session via create first
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "navigate", { url: "https://example.com" });
    expect(calls).toContain("navigate:https://example.com");
    expect(JSON.parse(res.content[0].text)).toEqual({ url: "https://example.com", title: "Fake Title" });
  });

  it("navigate rejects blocked protocols", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "navigate", { url: "file:///etc/passwd" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Blocked protocol");
  });

  it("navigate without url returns a validation error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "navigate", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("url must be");
  });

  it("navigate with no active session returns error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "navigate", { url: "https://example.com" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No active session");
  });

  it("navigate with explicit unknown sessionId returns not-found", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "navigate", { url: "https://example.com", sessionId: "ghost" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not found");
  });

  it("scrape delegates to SessionActions.scrape and returns content", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "scrape", { url: "https://example.com", format: "html" });
    expect(calls).toContain("scrape:https://example.com:html");
    const block = res.content[0];
    expect(block.type).toBe("text");
    if (block.type === "text") {
      expect(JSON.parse(block.text)).toMatchObject({ content: "Hello", url: "https://example.com" });
    }
  });

  it("scrape rejects blocked protocols", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "scrape", { url: "data:text/html,evil" });
    expect(res.isError).toBe(true);
  });

  it("screenshot returns a base64 image content block", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "screenshot", { fullPage: true });
    expect(calls).toContain("screenshot:true");
    const block = res.content[0];
    expect(block.type).toBe("image");
    if (block.type === "image") {
      expect(block.mimeType).toBe("image/png");
      // base64 of PNG magic bytes [0x89,0x50,0x4e,0x47]
      expect(Buffer.from(block.data, "base64").subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  });

  it("screenshot with no active session returns error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "screenshot", {});
    expect(res.isError).toBe(true);
  });

  it("release destroys the active session", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "release", {});
    expect(calls.some((c) => c.startsWith("destroy:"))).toBe(true);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ status: "released" });
  });

  it("unknown tool returns an error result", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "frobnicate", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown tool");
  });

  it("handler exceptions are caught and returned as error results", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    // Force navigate to throw by making actions.navigate reject
    (deps.actions as unknown as { navigate: () => Promise<never> }).navigate = async () => {
      throw new Error("boom");
    };
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "navigate", { url: "https://example.com" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("boom");
  });
});
