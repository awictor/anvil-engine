# Changelog

All notable changes to the Anvil Engine are documented here.

## [Unreleased]

### Added
- **README** — top-level `README.md`: what/why, install, run (with/without Docker),
  MCP server pointer, quickstart (curl + `AnvilClient` SDK), a 33-endpoint API
  overview, a full env-var table (including the `ANVIL_PERSIST_PATH` plaintext-
  cookie caveat), and testing instructions. Every fact derived from source.
- **Multi-page / tabs: HTTP routes** — new `/v1/pages` endpoints expose the
  multi-page service methods: `GET /v1/pages` (list), `POST /v1/pages` (open,
  optional url, blocks file/js/data), `DELETE /v1/pages/:index` (close, validates
  integer index). **Contract change: endpoint count 30 → 33** — `/v1/docs` gains a
  `pages` category and the count, `test/integration.test.ts`, and the `AnvilClient`
  SDK (`listPages`/`openPage`/`closePage`) were all updated together. 4 new
  integration tests + 1 HTTP-driven E2E (480 default, 9 E2E).
- **Multi-page / tabs: service layer** — `SessionActions` gains `listPages`,
  `openPage` (blocks file/js/data protocols), and `closePage` (validates index,
  refuses to close the last page), operating over the session's cached browser.
  Service-layer first; HTTP routes follow next. 2 new gated-E2E tests with real
  Chrome. No HTTP contract change yet.
- **Session persistence: restore on startup** — when `ANVIL_PERSIST_PATH` points at
  a saved file, the engine re-creates each persisted session on startup (fresh id,
  original launch options) and re-injects its cookies, logging restored/failed
  counts. New `restoreSessions` helper restores each record independently — one
  launch/inject failure is isolated and counted, never aborting the rest. This
  completes the session-persistence feature (serialize → save → load → restore).
  4 new tests (476 total). No HTTP contract change.
- **Session persistence: disk I/O (opt-in)** — new `ANVIL_PERSIST_PATH` env var
  (unset = disabled, no writes). On graceful shutdown the engine gathers each live
  session's cookies (best-effort) and writes serialized session metadata to the
  path; on startup it logs how many sessions are restorable. Added
  `loadPersisted` / `saveToDisk` helpers (missing/garbage file → []). Session
  re-creation on startup is a follow-up. 5 new tests (472 total). No HTTP contract change.
- **Session persistence: serialization layer** — `src/persistence.ts` adds pure
  `toPersisted` / `serializeSessions` / `deserializeSessions` functions converting
  between live sessions and a versioned JSON envelope (id, options, createdAt,
  cookies). `deserializeSessions` is tolerant — malformed JSON, version mismatch,
  or bad shape yields `[]` so a corrupt file can never crash startup. No disk or
  browser wiring yet (next iteration). 10 unit tests (467 total).
- **MCP server docs** — `docs/MCP.md` documents how to run the stdio MCP server
  (`npm run mcp` / `node dist/mcp/server.js`), a copy-paste `.mcp.json` config for
  Claude Code, all 10 tools with args/returns, and the env vars that actually
  affect the MCP path (clarifying that HTTP-only settings do not). Completes the
  MCP server layer backlog item.
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
