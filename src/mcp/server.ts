import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { SessionManager } from "../session.js";
import { SessionActions } from "../actions.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { createTools, dispatchTool, type McpTool } from "./tools.js";

const logger = createLogger("mcp");

/**
 * Builds an MCP Server backed by the Anvil tool registry. The registry holds
 * plain JSON Schema + handlers, so we wire it through the low-level Server with
 * tools/list + tools/call handlers rather than registerTool (which wants Zod
 * shapes). Exported separately from main() so tests can inspect wiring without
 * binding stdio or launching Chrome.
 */
export function buildMcpServer(tools: McpTool[]): Server {
  const server = new Server(
    { name: "anvil-engine", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // dispatchTool returns the standard CallTool result ({ content, isError? });
    // cast past the SDK's broader task-augmented union.
    return dispatchTool(tools, name, (args as Record<string, unknown>) || {}) as unknown as {
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    };
  });

  return server;
}

export function buildAnvilTools(): McpTool[] {
  const config = loadConfig();
  const pool = undefined; // MCP runs sessions on demand; no warm pool needed.
  const sessionManager = new SessionManager(pool);
  const actions = new SessionActions(sessionManager, {
    evaluateTimeoutMs: config.evaluateTimeoutMs,
    harMaxEntries: config.harMaxEntries,
  });
  sessionManager.startCleanup(config.sessionTimeoutMs);
  return createTools({ sessionManager, actions });
}

async function main(): Promise<void> {
  const tools = buildAnvilTools();
  const server = buildMcpServer(tools);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Anvil MCP server running on stdio", { tools: tools.length });
}

// Only auto-start when run directly (tsx src/mcp/server.ts), not when imported by tests.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry && import.meta.url === entry) {
  main().catch((err) => {
    logger.error("MCP server failed to start", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
