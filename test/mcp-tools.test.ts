import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTools, dispatchTool, type McpDeps } from "../src/mcp/tools.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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
    async click(_session: unknown, params: { selector: string }) {
      calls.push(`click:${params.selector}`);
    },
    async type(_session: unknown, params: { selector: string; text: string }) {
      calls.push(`type:${params.selector}:${params.text}`);
    },
    async evaluate(_session: unknown, script: string) {
      calls.push(`evaluate:${script}`);
      return { evaluated: script.length };
    },
    async getCookies(_session: unknown) {
      calls.push("getCookies");
      return [{ name: "sid", value: "abc" }];
    },
    async setCookies(_session: unknown, cookies: unknown[]) {
      calls.push(`setCookies:${cookies.length}`);
      return cookies.length;
    },
    async listPages(_session: unknown) {
      calls.push("listPages");
      return [{ index: 0, url: "about:blank", title: "" }];
    },
    async openPage(_session: unknown, url?: string) {
      calls.push(`openPage:${url ?? ""}`);
      return { index: 1, url: url ?? "about:blank" };
    },
    async closePage(_session: unknown, index: number) {
      calls.push(`closePage:${index}`);
      return { closed: index, remaining: 1 };
    },
  } as unknown as McpDeps["actions"];

  return { deps: { sessionManager, actions }, calls };
}

describe("MCP tool registry", () => {
  it("exposes the core tool set with names and schemas", () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["create_session", "navigate", "scrape", "screenshot", "click", "type", "evaluate", "get_cookies", "set_cookies", "list_pages", "open_page", "close_page", "release"]);
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

  // DEV-0098: README + docs/MCP.md advertise an MCP tool COUNT ("N tools"). A new tool that isn't
  // reflected in both docs misleads users about the surface. Assert the real count == each doc's claim.
  it("the advertised MCP tool count in README + docs/MCP.md matches createTools()", () => {
    const { deps } = makeDeps();
    const actual = createTools(deps).length;
    const claim = (text: string, where: string): number => {
      const m = text.match(/(\d+)\s+tools/i);
      expect(m, `no "N tools" claim found in ${where}`).not.toBeNull();
      return Number(m![1]);
    };
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const mcpDoc = readFileSync(join(ROOT, "docs", "MCP.md"), "utf8");
    expect(claim(readme, "README.md"), "README tool count").toBe(actual);
    expect(claim(mcpDoc, "docs/MCP.md"), "docs/MCP.md tool count").toBe(actual);
  });

  // DEV-0100: docs/MCP.md also carries a full tool TABLE (name + required args). The count guard above
  // misses a RENAME or a required-arg drift. Parse the `| `tool` | required | ... |` rows and assert
  // (a) the documented name-set == createTools() names, and (b) each row's required arg (backtick
  // tokens, ignoring the `—` placeholder) is in that tool's inputSchema.required.
  it("docs/MCP.md tool table matches createTools() names + required args", () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const byName = new Map(tools.map((t) => [t.name, t]));
    const fullDoc = readFileSync(join(ROOT, "docs", "MCP.md"), "utf8");
    // Scope to the tool table only — the env-var table has the same `| `NAME` | ... |` row shape, so
    // slice from the "| Tool | Required args |" header to the next blank line before parsing rows.
    const tableStart = fullDoc.indexOf("| Tool | Required args |");
    expect(tableStart, "tool table header present in docs/MCP.md").toBeGreaterThan(-1);
    const rest = fullDoc.slice(tableStart);
    const mcpDoc = rest.slice(0, rest.indexOf("\n\n"));

    // A tool row: | `name` | <required cell> | <optional> | <returns> |. The header/separator rows
    // (`| Tool |`, `|---|`) have no backticked first cell, so they don't match.
    const rowRe = /^\|\s*`(\w+)`\s*\|([^|]*)\|/gm;
    const documented: { name: string; required: string[] }[] = [];
    for (let m = rowRe.exec(mcpDoc); m; m = rowRe.exec(mcpDoc)) {
      const required = (m[2].match(/`(\w+)`/g) ?? []).map((s) => s.replace(/`/g, ""));
      documented.push({ name: m[1], required });
    }

    // (a) exact name-set parity (catches a rename / added / removed tool).
    const docNames = documented.map((d) => d.name).sort();
    expect(docNames, "documented tool names vs createTools()").toEqual([...byName.keys()].sort());

    // (b) every documented required arg is actually required by the tool's schema.
    for (const { name, required } of documented) {
      const tool = byName.get(name)!;
      const schemaRequired = (tool.inputSchema.required ?? []) as string[];
      for (const arg of required) {
        expect(schemaRequired, `${name}: doc says "${arg}" required`).toContain(arg);
      }
    }
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

  it("click delegates to SessionActions.click and returns success", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "click", { selector: "#btn" });
    expect(calls).toContain("click:#btn");
    const block = res.content[0];
    expect(block.type).toBe("text");
    if (block.type === "text") expect(JSON.parse(block.text)).toEqual({ success: true, selector: "#btn" });
  });

  it("click without selector returns a validation error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "click", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("selector must be");
  });

  it("type delegates to SessionActions.type with text", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "type", { selector: "#in", text: "hello" });
    expect(calls).toContain("type:#in:hello");
    const block = res.content[0];
    if (block.type === "text") expect(JSON.parse(block.text)).toEqual({ success: true, selector: "#in" });
  });

  it("type without text returns a validation error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "type", { selector: "#in" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("text must be");
  });

  it("click with no active session returns error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "click", { selector: "#btn" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No active session");
  });

  it("evaluate delegates to SessionActions.evaluate and returns the result", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "evaluate", { script: "1+1" });
    expect(calls).toContain("evaluate:1+1");
    const block = res.content[0];
    if (block.type === "text") expect(JSON.parse(block.text)).toEqual({ evaluated: 3 });
  });

  it("evaluate without script returns a validation error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "evaluate", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("script must be");
  });

  it("evaluate rejects scripts over the 100KB limit", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "evaluate", { script: "x".repeat(100_001) });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("100KB");
  });

  it("evaluate with no active session returns error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "evaluate", { script: "1+1" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No active session");
  });

  it("get_cookies delegates to SessionActions.getCookies", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "get_cookies", {});
    expect(calls).toContain("getCookies");
    const block = res.content[0];
    if (block.type === "text") expect(JSON.parse(block.text)).toEqual({ cookies: [{ name: "sid", value: "abc" }] });
  });

  it("set_cookies delegates to SessionActions.setCookies and returns count", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "set_cookies", { cookies: [{ name: "a", value: "1" }, { name: "b", value: "2" }] });
    expect(calls).toContain("setCookies:2");
    const block = res.content[0];
    if (block.type === "text") expect(JSON.parse(block.text)).toEqual({ injected: 2 });
  });

  it("set_cookies without an array returns a validation error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "set_cookies", { cookies: "not-an-array" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("must be an array");
  });

  it("get_cookies with no active session returns error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "get_cookies", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No active session");
  });

  it("list_pages delegates to SessionActions.listPages", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const res = await dispatchTool(tools, "list_pages", {});
    expect(calls).toContain("listPages");
    const block = res.content[0];
    if (block.type === "text") expect(JSON.parse(block.text)).toEqual({ pages: [{ index: 0, url: "about:blank", title: "" }] });
  });

  it("open_page delegates with optional url and blocks dangerous protocols", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const ok = await dispatchTool(tools, "open_page", { url: "https://example.com" });
    expect(calls).toContain("openPage:https://example.com");
    const block = ok.content[0];
    if (block.type === "text") expect(JSON.parse(block.text)).toEqual({ index: 1, url: "https://example.com" });

    const blocked = await dispatchTool(tools, "open_page", { url: "file:///etc/passwd" });
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain("Blocked protocol");
  });

  it("close_page requires a non-negative integer index", async () => {
    const { deps, calls } = makeDeps();
    const tools = createTools(deps);
    await dispatchTool(tools, "create_session", {});
    const ok = await dispatchTool(tools, "close_page", { index: 1 });
    expect(calls).toContain("closePage:1");
    const block = ok.content[0];
    if (block.type === "text") expect(JSON.parse(block.text)).toEqual({ closed: 1, remaining: 1 });

    const bad = await dispatchTool(tools, "close_page", { index: -1 });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("non-negative integer");
  });

  it("page tools with no active session return error", async () => {
    const { deps } = makeDeps();
    const tools = createTools(deps);
    const res = await dispatchTool(tools, "list_pages", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No active session");
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
