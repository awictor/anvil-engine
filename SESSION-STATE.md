# Session State — Anvil Engine

## Current Version
v1.0.0 | 36 endpoints | 483 tests (+12 gated E2E with real Chrome) | MCP server (stdio, 10 tools, documented) | session persistence (opt-in)

## Last Completed
- Browser contexts (HTTP routes): /v1/contexts GET (list) + POST (create) + DELETE
  /v1/contexts/:id (close) in routes/contexts.ts. Contract 33→36: docs count +
  contexts category, both docs-count assertions, 3 SDK methods. 3 integration tests
  + 1 HTTP-driven E2E (483 default, 12 E2E). Cookie-isolation proof still pending.
- Browser contexts (service layer): SessionActions createContext/listContexts/
  closeContext over per-session BrowserContext Map, cleaned up on destroy. 2 E2E tests.
- README: top-level README.md — install, run (with/without Docker), MCP pointer,
  quickstart, 33-endpoint overview, env-var table (incl. ANVIL_PERSIST_PATH
  plaintext-cookie caveat), testing. Docs-only; verified against source.
- Multi-page/tabs COMPLETE (HTTP routes): /v1/pages GET (list) + POST (open) +
  DELETE /v1/pages/:index (close). Contract 30→33: docs count + pages category,
  integration.test.ts (both count assertions), 3 SDK client methods. 4 integration
  tests + 1 HTTP-driven E2E.
- Multi-page/tabs (service layer): SessionActions listPages/openPage/closePage.
  openPage blocks file/js/data; closePage validates index + refuses last page.
- Session persistence COMPLETE: restore on startup. When ANVIL_PERSIST_PATH has a
  saved file, app.start() re-creates each session (fresh id, original options) +
  re-injects cookies. restoreSessions isolates per-record failures. 4 tests.
- Session persistence (disk I/O, opt-in): `ANVIL_PERSIST_PATH` env. app.stop()
  writes serialized metadata + cookies; app.start() logs restorable count.
  loadPersisted/saveToDisk (missing/garbage file → []). 5 tests.
- Session persistence (serialization layer): `src/persistence.ts` — pure
  toPersisted/serializeSessions/deserializeSessions over a versioned JSON envelope.
  Corruption-tolerant deserialize. 10 tests.
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
- Host disk filled to 100% during an iteration (ENOSPC truncated CHANGELOG.md mid-write; recovered via `git checkout`). Cleared ~5G of leaked Temp dirs (HeadlessChrome*/anvil-*/scoped_dir*). E2E runs leak Chrome temp profiles when Chrome isn't cleanly killed — run `taskkill //F //IM chrome.exe` + clear `%TEMP%/HeadlessChrome*` periodically. Host was already near-full from unrelated data.

## Backlog (Priority Order)
Each item is done when ALL success criteria pass. One item per iteration.

1. **Browser contexts** — Isolated incognito contexts within one browser process.
   - Success: route + SessionActions support for creating/using/closing a context; isolation test (cookies in context A invisible to B). Contract updates in same iteration.
   - DONE: SessionActions createContext/listContexts/closeContext + 2 gated-E2E tests + destroy cleanup.
   - DONE: /v1/contexts routes (33→36), docs/integration/client all updated, 3 integration + 1 E2E.
   - NEXT (completes the item): cookie-isolation E2E. Add a context-scoped variant — e.g. SessionActions method that opens a page in a named context, sets a cookie there, and checks a page in the default (or another) context can't see it. Prove isolation in a gated E2E. Only then mark this item DONE. If context-scoped navigation needs a new param/method, scope it minimally.

2. **Live session view** — Read-only view into a running session.
   - Success: endpoint streaming periodic JPEG frames (CDP Page.screencast or polled screenshot); test for endpoint shape/headers. Contract updates in same iteration.

3. **MCP page tools** — keep MCP at parity with the new HTTP surface: add list_pages/open_page/close_page to createTools, delegating to the SessionActions page methods. Dispatch tests + update both tools/list assertions (13 tools).

4. **Persistence follow-ups** — (a) gated E2E test for a real-Chrome save→restart→restore round-trip; (b) consider preserving session ids across restore (currently fresh ids) if clients depend on stable ids.

5. **Repo hygiene: gitignore node_modules** — node_modules is currently tracked in git (no .gitignore), so dependency installs produce huge noisy diffs. Add a `.gitignore` (node_modules, dist, *.log, coverage) and `git rm -r --cached node_modules dist` in one commit. Verify `git status` is clean afterward and the build still works. CAUTION: this is a large tree-touching change — do it as its own isolated iteration.

6. **Ongoing hardening (standing item — never remove)** — When no higher item is actionable, do ONE unit: add an edge-case or security test, tighten one input validation, improve one error message, or close one small rough edge. Keep growing test coverage of launcher.ts, cdp-proxy.ts, and the SessionActions crash-recovery path.

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
