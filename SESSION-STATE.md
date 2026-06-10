# Session State — Anvil Engine

## Current Version
v1.0.0 | 30 endpoints | 467 tests (+6 gated E2E with real Chrome) | MCP server (stdio, 10 tools, documented)

## Last Completed
- Session persistence (serialization layer): `src/persistence.ts` — pure
  toPersisted/serializeSessions/deserializeSessions over a versioned JSON envelope
  (id, options, createdAt, cookies). deserialize is corruption-tolerant (returns
  [] on bad/old/malformed input). No disk/browser wiring yet. 10 tests (467 total).
- MCP server docs: `docs/MCP.md` — run instructions, `.mcp.json` config for Claude
  Code, all 10 tools with args/returns, MCP-relevant env vars. Completes MCP layer.
- MCP tools get_cookies + set_cookies: added to `createTools` (10 tools total,
  core parity complete). get_cookies returns { cookies }; set_cookies validates
  the array and returns { injected }. 4 dispatch tests (457 total).
- MCP tool evaluate: added to `createTools`. Validates script non-empty + 100KB
  cap (matching the HTTP route); delegates to SessionActions.evaluate. 4 tests.
- MCP tools click + type: added to `createTools`. Both validate selector (and
  text for type) as non-empty strings, matching the HTTP routes; delegate to
  SessionActions. 5 dispatch tests.
- MCP tools scrape + screenshot: added to `createTools`. scrape returns text/html
  (file/js/data protocols blocked); screenshot returns a base64 image/png block
  (McpContent widened to text|image). 4 dispatch tests.
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

1. **Session persistence across restart** — Survive an engine restart without losing session metadata + cookies.
   - Success: opt-in flag/env; on graceful shutdown serialize session list + cookies to disk; on startup offer to restore; round-trip test (serialize → deserialize → cookies match). No always-on disk writes.
   - DONE: pure serialization layer (`src/persistence.ts`) + 10 round-trip/tolerance tests.
   - NEXT (actionable sub-task): add disk I/O + an opt-in env flag. New `ANVIL_PERSIST_PATH` (unset = disabled, no writes). On graceful shutdown (app.ts stop()), for each live session fetch cookies via SessionActions.getCookies, build toPersisted records, serializeSessions, write to the path. Add a `loadPersisted(path)` helper (reads file, returns deserializeSessions or [] if missing). Wire a startup log of how many would restore. Unit-test the file read/write helper with a temp path. Actual session re-creation on startup is a follow-up. No HTTP contract change.

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
