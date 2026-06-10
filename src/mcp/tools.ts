import { type SessionManager } from "../session.js";
import { type SessionActions } from "../actions.js";

/**
 * Transport-agnostic MCP tool layer for the Anvil Engine. Each tool exposes a
 * JSON input schema and a handler that resolves the target session and calls
 * into the existing SessionManager / SessionActions — no browser logic is
 * duplicated here. A stdio/HTTP MCP transport wraps this registry separately.
 */

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

export interface McpDeps {
  sessionManager: SessionManager;
  actions: SessionActions;
}

function text(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

function error(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function image(data: string, mimeType: string): McpToolResult {
  return { content: [{ type: "image", data, mimeType }] };
}

type Resolved =
  | { session: import("../session.js").Session; err?: undefined }
  | { session?: undefined; err: string };

/** Resolves a session by explicit id (arg) or falls back to the active one. */
function resolve(deps: McpDeps, args: Record<string, unknown>): Resolved {
  const id = typeof args.sessionId === "string" && args.sessionId ? args.sessionId : "";
  if (id) {
    const session = deps.sessionManager.get(id);
    return session ? { session } : { err: `Session ${id} not found` };
  }
  const active = deps.sessionManager.getActive();
  return active ? { session: active } : { err: "No active session" };
}

export function createTools(deps: McpDeps): McpTool[] {
  return [
    {
      name: "create_session",
      description: "Launch a new browser session and return its id and CDP details.",
      inputSchema: {
        type: "object",
        properties: {
          headless: { type: "boolean", description: "Run headless (default true)" },
          stealth: { type: "boolean", description: "Enable fingerprint/anti-detection (default true)" },
          userAgent: { type: "string", description: "Override the browser user-agent" },
          width: { type: "number", description: "Viewport width (default 1920)" },
          height: { type: "number", description: "Viewport height (default 1080)" },
        },
      },
      handler: async (args) => {
        const session = await deps.sessionManager.create({
          headless: args.headless as boolean | undefined,
          stealth: args.stealth as boolean | undefined,
          userAgent: args.userAgent as string | undefined,
          width: args.width as number | undefined,
          height: args.height as number | undefined,
        });
        return text({ id: session.id, status: session.status, cdpPort: session.browserProcess.cdpPort });
      },
    },
    {
      name: "navigate",
      description: "Navigate the session's page to a URL. Targets the active session unless sessionId is given.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "http(s) URL to load" },
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
          waitUntil: { type: "string", description: "Puppeteer waitUntil (default networkidle2)" },
          timeout: { type: "number", description: "Navigation timeout ms (max 60000)" },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const url = args.url;
        if (typeof url !== "string" || !url) return error("url must be a non-empty string");
        if (/^(file|javascript|data):/i.test(url)) return error("Blocked protocol: only http/https allowed");
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        const result = await deps.actions.navigate(r.session, {
          url,
          waitUntil: args.waitUntil as string | undefined,
          timeout: args.timeout as number | undefined,
        });
        return text(result);
      },
    },
    {
      name: "scrape",
      description: "Navigate to a URL and extract its content as text or html. Targets the active session unless sessionId is given.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "http(s) URL to load" },
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
          format: { type: "string", description: "'text' (default) or 'html'" },
          waitForSelector: { type: "string", description: "Optional selector to wait for before extracting" },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const url = args.url;
        if (typeof url !== "string" || !url) return error("url must be a non-empty string");
        if (/^(file|javascript|data):/i.test(url)) return error("Blocked protocol: only http/https allowed");
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        const result = await deps.actions.scrape(r.session, {
          url,
          format: args.format as string | undefined,
          waitForSelector: args.waitForSelector as string | undefined,
        });
        return text(result);
      },
    },
    {
      name: "screenshot",
      description: "Capture a PNG screenshot of the session's current page, returned as a base64 image.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
          fullPage: { type: "boolean", description: "Capture the full scrollable page (default false)" },
        },
      },
      handler: async (args) => {
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        const bytes = await deps.actions.screenshot(r.session, args.fullPage === true);
        const base64 = Buffer.from(bytes).toString("base64");
        return image(base64, "image/png");
      },
    },
    {
      name: "click",
      description: "Click an element by CSS selector. Targets the active session unless sessionId is given.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the element to click" },
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
          button: { type: "string", description: "'left' (default), 'right', or 'middle'" },
          clickCount: { type: "number", description: "Number of clicks (default 1)" },
        },
        required: ["selector"],
      },
      handler: async (args) => {
        const selector = args.selector;
        if (typeof selector !== "string" || !selector) return error("selector must be a non-empty string");
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        await deps.actions.click(r.session, {
          selector,
          button: args.button as string | undefined,
          clickCount: args.clickCount as number | undefined,
        });
        return text({ success: true, selector });
      },
    },
    {
      name: "type",
      description: "Type text into an element by CSS selector. Targets the active session unless sessionId is given.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the input element" },
          text: { type: "string", description: "Text to type" },
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
          delay: { type: "number", description: "Per-keystroke delay ms (max 500)" },
        },
        required: ["selector", "text"],
      },
      handler: async (args) => {
        const selector = args.selector;
        if (typeof selector !== "string" || !selector) return error("selector must be a non-empty string");
        const value = args.text;
        if (typeof value !== "string" || !value) return error("text must be a non-empty string");
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        await deps.actions.type(r.session, {
          selector,
          text: value,
          delay: args.delay as number | undefined,
        });
        return text({ success: true, selector });
      },
    },
    {
      name: "evaluate",
      description: "Execute JavaScript in the session's page and return the result. Targets the active session unless sessionId is given.",
      inputSchema: {
        type: "object",
        properties: {
          script: { type: "string", description: "JavaScript to evaluate in the page context" },
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
        },
        required: ["script"],
      },
      handler: async (args) => {
        const script = args.script;
        if (typeof script !== "string" || !script) return error("script must be a non-empty string");
        if (script.length > 100_000) return error("script exceeds 100KB limit");
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        const result = await deps.actions.evaluate(r.session, script);
        return text(result);
      },
    },
    {
      name: "get_cookies",
      description: "Get all cookies from the session. Targets the active session unless sessionId is given.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
        },
      },
      handler: async (args) => {
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        const cookies = await deps.actions.getCookies(r.session);
        return text({ cookies });
      },
    },
    {
      name: "set_cookies",
      description: "Inject cookies into the session. Targets the active session unless sessionId is given.",
      inputSchema: {
        type: "object",
        properties: {
          cookies: { type: "array", description: "Array of cookie objects to set" },
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
        },
        required: ["cookies"],
      },
      handler: async (args) => {
        if (!Array.isArray(args.cookies)) return error("cookies must be an array");
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        const injected = await deps.actions.setCookies(r.session, args.cookies as Parameters<typeof deps.actions.setCookies>[1]);
        return text({ injected });
      },
    },
    {
      name: "release",
      description: "Destroy a browser session and free its resources.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Target session id (optional; defaults to active)" },
        },
      },
      handler: async (args) => {
        const r = resolve(deps, args);
        if (!r.session) return error(r.err);
        const released = await deps.sessionManager.destroy(r.session.id);
        if (!released) return error(`Session ${r.session.id} not found`);
        return text({ id: released.id, status: "released" });
      },
    },
  ];
}

/** Dispatches a tool call by name. Returns an MCP error result for unknown tools. */
export async function dispatchTool(
  tools: McpTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return error(`Unknown tool: ${name}`);
  try {
    return await tool.handler(args || {});
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
