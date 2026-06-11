# Anvil Engine

An independent **browser-as-a-service** engine: real Chrome driven over the
[Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/),
exposed through a REST API, a WebSocket CDP proxy, a TypeScript SDK, and an MCP
server. Zero third-party browser-infrastructure dependencies — it runs Chrome
itself, so there is no external service, API key, or vendor in the path.

- **38 REST endpoints** for sessions, navigation, scraping, PDF, screenshots,
  live view (single frame + MJPEG stream), page actions, cookies, multi-tab
  control, isolated browser contexts, HAR capture, request interception,
  action recording, and downloads.
- **MCP server** (13 tools) so Claude Code / agents can drive browsers directly — see [docs/MCP.md](docs/MCP.md).
- **Typed SDK** (`AnvilClient`) covering every endpoint.
- **Operational**: structured JSON logs, per-endpoint latency metrics, liveness/
  readiness probes, rate limiting, API-key auth, session timeouts, optional
  warm-browser pool, fingerprint randomization, and opt-in session persistence.

## Requirements

- Node.js 22+
- Google Chrome or Chromium installed (auto-detected on Windows/macOS/Linux, or
  point `CHROME_PATH` at the binary)

## Install

```bash
npm install
```

Only two runtime dependencies (`puppeteer-core`, `ws`) plus the MCP SDK — no
bundled browser is downloaded.

## Run (without Docker)

```bash
npm run dev      # tsx src/api.ts — runs from source
# or
npm run build    # tsc -> dist/
npm start        # node dist/api.js
```

The server listens on `http://0.0.0.0:3000` by default and exposes a CDP
WebSocket proxy at `ws://<host>:<port>/cdp?session=<id>` (add `&token=<key>` when
`ANVIL_API_KEY` is set).

```bash
curl http://localhost:3000/v1/health
```

## Run with Docker

```bash
npm run build
docker build -t anvil-engine .
docker run -p 3000:3000 anvil-engine
```

The image is `node:22-slim` + Chromium with `CHROME_PATH=/usr/bin/chromium` and
a `HEALTHCHECK` against `/v1/live`.

## MCP server

Anvil ships an MCP server (stdio) that exposes browser automation as tools for
Claude Code / agents:

```bash
npm run mcp      # tsx src/mcp/server.ts
```

See [docs/MCP.md](docs/MCP.md) for the tool list and a copy-paste `.mcp.json`
config.

## Quickstart

### REST

```bash
# create a session
SID=$(curl -s -XPOST localhost:3000/v1/sessions -d '{"headless":true}' | jq -r .id)
# navigate, then screenshot
curl -s -XPOST "localhost:3000/v1/actions/navigate?sessionId=$SID" -d '{"url":"https://example.com"}'
curl -s "localhost:3000/v1/screenshot?sessionId=$SID" -o shot.png
# release
curl -s -XPOST "localhost:3000/v1/sessions/$SID/release"
```

Target a specific session with the `X-Session-Id` header or `?sessionId=`; omit
both to use the active session.

### SDK

```ts
import { AnvilClient } from "anvil-engine/client";

const anvil = new AnvilClient({ baseUrl: "http://localhost:3000" /*, apiKey */ });

const { id } = await anvil.createSession({ headless: true });
await anvil.navigate("https://example.com", { sessionId: id });
const { content } = await anvil.scrape("https://example.com", { sessionId: id, format: "text" });
await anvil.releaseSession(id);
```

## API overview

The full, authoritative list lives at `GET /v1/docs` (38 endpoints). Summary:

| Area | Endpoints |
|---|---|
| Sessions | `POST/GET /v1/sessions`, `GET /v1/sessions/:id`, `GET /v1/sessions/list`, `POST /v1/sessions/:id/release` |
| Actions | `/v1/actions/{navigate,click,type,select,hover,wait,evaluate,upload}` |
| Content | `POST /v1/scrape`, `POST /v1/pdf`, `GET /v1/screenshot`, `GET /v1/view`, `GET /v1/view/stream`, `GET/POST /v1/cookies` |
| Pages/tabs | `GET/POST /v1/pages`, `DELETE /v1/pages/:index` |
| Contexts | `GET/POST /v1/contexts`, `DELETE /v1/contexts/:id` |
| Network | `POST /v1/har/start`, `POST /v1/har/stop`, `GET /v1/har`, `POST /v1/intercept` |
| Recording | `POST /v1/recording/start`, `POST /v1/recording/stop`, `GET /v1/recording` |
| Files | `GET /v1/downloads`, `GET /v1/downloads/:filename` |
| Observability | `GET /v1/health`, `GET /v1/metrics`, `GET /v1/docs` |

`GET /v1/view` returns a single JPEG frame of the session viewport;
`GET /v1/view/stream` is an MJPEG stream (`?fps=` 1–10, default 2, `?quality=`
1–100) you can point an `<img src>` at to watch a session live.

Operational probes `GET /v1/live` and `GET /v1/ready` exist for orchestrators and
are intentionally not part of the documented endpoint catalog.

## Configuration

All configuration is via environment variables (validated at startup; invalid
values fail fast with an aggregated error).

| Variable | Default | Purpose |
|---|---|---|
| `ANVIL_ENGINE_PORT` | `3000` | HTTP listen port |
| `ANVIL_HOST` | `0.0.0.0` | Bind address (set `127.0.0.1` for local-only) |
| `ANVIL_API_KEY` | _(unset)_ | When set, requires `Authorization: Bearer <key>` (and `?token=` on the CDP proxy) |
| `ANVIL_SESSION_TIMEOUT_MS` | `300000` | Idle session auto-cleanup window |
| `ANVIL_MAX_SESSIONS` | `10` | Reject new sessions past this many (503) |
| `ANVIL_RATE_LIMIT_RPM` | `0` (off) | Per-IP requests/minute token bucket |
| `ANVIL_POOL_SIZE` | `0` (off) | Warm pre-launched browser instances |
| `ANVIL_EVALUATE_TIMEOUT_MS` | `30000` | Max `evaluate` runtime before termination (cap 60000) |
| `ANVIL_HAR_MAX_ENTRIES` | `5000` | Cap on HAR entries captured per session |
| `ANVIL_WEBHOOK_URL` | _(unset)_ | POST session lifecycle events here |
| `ANVIL_PERSIST_PATH` | _(unset, disabled)_ | Persist sessions + cookies to this file on shutdown and restore on startup. **Cookies are stored in plaintext at this path — restrict file permissions or avoid on shared hosts.** |
| `CHROME_PATH` | auto-detected | Path to the Chrome/Chromium binary |
| `ANVIL_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

## Testing

```bash
npm test                                   # default suite (no Chrome needed)
npx vitest run --config vitest.e2e.config.ts   # gated E2E (launches real Chrome)
```

The default suite is fully self-contained — it boots the real HTTP server on an
ephemeral port and exercises routing, auth, rate limiting, validation, and the
service layer without launching a browser. The E2E suite drives real Chrome and
auto-skips when no browser is installed.

## License

Internal Amazon tool. See repository for details.
