import { type SessionManager } from "../session.js";
import { type SessionActions } from "../actions.js";

/**
 * Transport-agnostic MCP tool layer for the Anvil Engine. Each tool exposes a
 * JSON input schema and a handler that resolves the target session and calls
 * into the existing SessionManager / SessionActions — no browser logic is
 * duplicated here. A stdio/HTTP MCP transport wraps this registry separately.
 */

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
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
