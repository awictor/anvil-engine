# Changelog

All notable changes to the Anvil Engine are documented here.

## [Unreleased]

### Added
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
