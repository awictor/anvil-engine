# Session State — Anvil Engine

## Current Version
v1.0.0 | 30 endpoints | 444 tests (+6 gated E2E with real Chrome) | MCP server (stdio, 5 tools)

## Last Completed
- MCP tools scrape + screenshot: added to `createTools` (5 tools total). scrape
  returns text/html (file/js/data protocols blocked); screenshot returns a
  base64 image/png content block (McpContent widened to text|image). Delegate to
  existing SessionActions. 4 dispatch tests (444 total). No HTTP contract change.
- MCP stdio transport: `src/mcp/server.ts` wires the tool registry into a
  low-level MCP Server (tools/list + tools/call) over StdioServerTransport; added
  `mcp` npm script; `buildMcpServer`/`buildAnvilTools` exported for testability.
  Added @modelcontextprotocol/sdk. 5 wiring tests.
- MCP tool layer scaffold: `src/mcp/tools.ts` — transport-agnostic registry +
  dispatcher with core tools create_session/navigate/release, each delegating to
  SessionManager/SessionActions (no duplicated browser logic). 11 unit tests.
- Code-review remediation + full refactor: extracted SessionActions service layer,
  router + middleware chain, and 7 route modules out of the 846-line monolithic
  api.ts; fixed 3 critical + 4 high bugs (session-cleanup race via in-flight
  refcount, HAR listener leak, evaluate timeout via CDP terminateExecution, SSRF
  proxy validation, CDP proxy auth, path traversal); added structured logging,
  validated config, per-endpoint latency metrics, /v1/live + /v1/ready probes;
  added 67 tests (integration server, launcher/config/cdp-proxy units,
  concurrency, gated Chrome E2E). All green, pushed to github.com/awictor/anvil-engine.

## Known Issues
- CRLF git warnings on commit are cosmetic (LF→CRLF on Windows checkout); ignore.
- E2E suite spawns real Chrome — run only via `vitest.e2e.config.ts`, not the default suite.

## Backlog (Priority Order)
Each item is done when ALL success criteria pass. One item per iteration.

1. **MCP server layer** — Expose SessionActions as MCP tools so Claude Code / MeshClaw can drive browser sessions directly.
   - DONE: tool registry + dispatcher (`src/mcp/tools.ts`), create_session/navigate/release.
   - DONE: stdio transport (`src/mcp/server.ts`), `mcp` npm script, wiring tests. `npm run mcp` works.
   - DONE: scrape + screenshot tools (5 total).
   - NEXT (actionable sub-task): add `click` + `type` tools to `createTools`, delegating to SessionActions.click/type, with dispatch tests in `test/mcp-tools.test.ts`. Update both tools/list name-list assertions (mcp-tools.test.ts AND mcp-server.test.ts) to include the new names. No HTTP contract change.
   - THEN: `evaluate`, then `get_cookies` + `set_cookies` (same pattern).
   - THEN: document the MCP server in README + add an `mcp.json` example config for Claude Code.

2. **Session persistence across restart** — Survive an engine restart without losing session metadata + cookies.
   - Success: opt-in flag/env; on graceful shutdown serialize session list + cookies to disk; on startup offer to restore; round-trip test (serialize → deserialize → cookies match). No always-on disk writes.

3. **Multi-tab / page support** — Address multiple pages within one session.
   - Success: new route(s) (e.g. /v1/pages list/open/close, page targeting param), matching SessionActions methods, tests. Bump /v1/docs count + update integration.test.ts + client.ts.

4. **Browser contexts** — Isolated incognito contexts within one browser process.
   - Success: route + SessionActions support for creating/using/closing a context; isolation test (cookies in context A invisible to B). Contract updates in same iteration.

5. **README + API reference** — Make the repo presentable and usable.
   - Success: top-level README.md (what/why/quickstart/run-without-docker/Docker/env vars table); API reference derived from /v1/docs; SDK (`client.ts`) usage examples that actually run; CHANGELOG.md seeded with v1.0.0 history.

6. **Live session view** — Read-only view into a running session.
   - Success: endpoint streaming periodic JPEG frames (CDP Page.screencast or polled screenshot); test for endpoint shape/headers. Contract updates in same iteration.

7. **Ongoing hardening (standing item — never remove)** — When no higher item is actionable, do ONE unit: add an edge-case or security test, tighten one input validation, improve one error message, or close one small rough edge. Keep growing test coverage of launcher.ts, cdp-proxy.ts, and the SessionActions crash-recovery path.

## Guardrails
- Gate every commit on `npx tsc --noEmit` + `npx vitest run` (424 baseline, never drop).
- Any change to actions.ts / session.ts / launcher.ts / cdp-proxy.ts / routes/* MUST add or extend a test.
- Run the E2E suite (`vitest.e2e.config.ts`) when changing real browser behavior.
- Public API contract frozen unless the task changes it on purpose; new endpoints update /v1/docs count + integration.test.ts + client.ts together. Probes (/v1/live, /v1/ready) stay out of the docs count.
- New browser logic → src/actions.ts; new endpoints → src/routes/*.ts wired in src/app.ts; MCP tools → src/mcp/ calling SessionActions. Never re-monolith api.ts.
- Security/concurrency self-review before commit: input validation, listener/connection cleanup on destroy, safeJoin for filenames, in-flight refcount, no unjustified exempt paths, SSRF surface unchanged.
- One focused task per iteration; small specific-file commits; update SESSION-STATE.md + CHANGELOG.md.

## Key Paths
- Source: `src/`
- Service layer (browser logic): `src/actions.ts` (SessionActions)
- Session lifecycle: `src/session.ts` | Launcher: `src/launcher.ts` | CDP proxy: `src/cdp-proxy.ts`
- Routes: `src/routes/*.ts` | Composition root + server factory: `src/app.ts` | Bootstrap: `src/api.ts`
- Middleware: `src/middleware.ts` | Router: `src/router.ts` | Path safety: `src/path-safety.ts`
- Config/logger/metrics: `src/config.ts` `src/logger.ts` `src/metrics.ts`
- SDK client: `src/client.ts`
- Tests: `test/` (default suite) | `test/e2e/` (real Chrome) | configs `vitest.config.ts`, `vitest.e2e.config.ts`
- Future MCP server: `src/mcp/`
