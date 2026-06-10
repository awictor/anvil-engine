# Changelog

All notable changes to the Anvil Engine are documented here.

## [Unreleased]

### Added
- **MCP tools: get_cookies + set_cookies** — the MCP tool set grows from 8 to 10,
  completing core parity with the HTTP actions. get_cookies returns `{ cookies }`;
  set_cookies validates the array (matching the HTTP route) and returns
  `{ injected }`. Both delegate to existing SessionActions. 4 new dispatch tests
  (457 total). No HTTP contract change.
- **MCP tool: evaluate** — the MCP tool set grows from 7 to 8. Validates script
  as a non-empty string with the same 100KB cap as the HTTP route, and delegates
  to SessionActions.evaluate (which enforces the CDP-terminate timeout). 4 new
  dispatch tests (453 total). No HTTP contract change.
- **MCP tools: click + type** — the MCP tool set grows from 5 to 7. Both validate
  selector (and text for type) as non-empty strings, matching the HTTP routes,
  and delegate to existing SessionActions methods. 5 new dispatch tests (449
  total). No HTTP contract change.
- **MCP tools: scrape + screenshot** — the MCP tool set grows from 3 to 5.
  `scrape` returns extracted text/html (with the same file/javascript/data
  protocol blocking as the HTTP route); `screenshot` returns a base64
  `image/png` content block (MCP-native image type). Both delegate to existing
  SessionActions methods. `McpContent` widened to a text|image union
  (backward-compatible). 4 new dispatch tests (444 total). No HTTP contract change.
- **MCP stdio transport** — `src/mcp/server.ts` wires the tool registry into a
  low-level MCP `Server` with `tools/list` + `tools/call` handlers over
  `StdioServerTransport`, plus an `mcp` npm script (`tsx src/mcp/server.ts`).
  `buildMcpServer` / `buildAnvilTools` are exported so wiring is testable without
  binding stdio or launching Chrome. Verified: `npm run mcp` completes an MCP
  handshake and lists create_session/navigate/release. Adds `@modelcontextprotocol/sdk`
  dependency. 5 new wiring tests (440 total).
  *Why:* Claude Code / MeshClaw can now connect to Anvil as an MCP server.
  *Impact:* no HTTP contract change (still 30 endpoints); remaining tools next.
- **MCP tool layer (scaffold)** — `src/mcp/tools.ts` introduces a transport-agnostic
  MCP tool registry and dispatcher with the core tool set `create_session`,
  `navigate`, `release`. Each tool carries a JSON input schema and resolves the
  target session (explicit `sessionId` or active) before delegating to the
  existing `SessionManager` / `SessionActions` — no browser logic is duplicated.
  *Why:* lets Claude Code / MeshClaw drive browser sessions as MCP tools.
  *Impact:* no HTTP contract change (still 30 endpoints); stdio transport and the
  remaining tools land in follow-up iterations. 11 new unit tests (435 total).

## [1.0.0]
- Independent browser-as-a-service engine: 30 REST endpoints, CDP WebSocket proxy,
  TypeScript SDK, Docker image.
- Service-layer architecture: `SessionActions` (browser logic), router + middleware
  chain, 7 route modules, composition root (`app.ts`).
- Hardening: in-flight refcount guarding the session-cleanup race, HAR listener
  cleanup on destroy, evaluate timeout via CDP `Runtime.terminateExecution`, SSRF
  proxy validation, CDP proxy auth, strict path-safety for file endpoints.
- Observability: structured JSON logging, validated config, per-endpoint latency
  metrics, `/v1/live` + `/v1/ready` probes.
- 424 tests + 6 gated real-Chrome E2E tests.
