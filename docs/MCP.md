# Anvil Engine — MCP Server

Anvil ships an [MCP](https://modelcontextprotocol.io) server that exposes browser
automation as tools, so an MCP client (Claude Code, MeshClaw, etc.) can drive real
Chrome sessions directly — no HTTP calls required. The MCP server reuses the same
`SessionActions` service that backs the REST API, so behavior is identical across
both surfaces.

## Running

```bash
# from source (dev)
npm run mcp            # tsx src/mcp/server.ts

# from a build
npm run build
node dist/mcp/server.js
```

The server speaks MCP over **stdio** (no port). It launches Chrome on demand per
`create_session` call — make sure Chrome/Chromium is installed, or set
`CHROME_PATH` to its binary.

## Claude Code config

Add Anvil to your `.mcp.json` (project root) or the global MCP config:

```json
{
  "mcpServers": {
    "anvil": {
      "command": "node",
      "args": ["C:/Users/awictor/anvil-engine/dist/mcp/server.js"],
      "env": {
        "CHROME_PATH": "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "ANVIL_SESSION_TIMEOUT_MS": "300000",
        "ANVIL_EVALUATE_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

For a no-build setup, point at the source instead:

```json
{
  "mcpServers": {
    "anvil": {
      "command": "npx",
      "args": ["tsx", "C:/Users/awictor/anvil-engine/src/mcp/server.ts"]
    }
  }
}
```

### Environment variables that affect the MCP server

The stdio server runs sessions on demand; it does **not** bind an HTTP port, so the
HTTP-only settings (`ANVIL_ENGINE_PORT`, `ANVIL_HOST`, `ANVIL_API_KEY`,
`ANVIL_RATE_LIMIT_RPM`, `ANVIL_POOL_SIZE`, `ANVIL_WEBHOOK_URL`) have no effect here.
The variables that matter:

| Variable | Default | Effect |
|---|---|---|
| `CHROME_PATH` | auto-detected | Path to the Chrome/Chromium binary |
| `ANVIL_SESSION_TIMEOUT_MS` | `300000` | Idle session auto-cleanup window (`0`/unset → default) |
| `ANVIL_EVALUATE_TIMEOUT_MS` | `30000` | Max runtime for an `evaluate` script before it is terminated (cap 60000) |
| `ANVIL_HAR_MAX_ENTRIES` | `5000` | Cap on captured HAR entries per session |

## Tools

10 tools (core parity with the REST API). Every tool targets the **active** session
unless an explicit `sessionId` is given.

| Tool | Required args | Optional args | Returns |
|---|---|---|---|
| `create_session` | — | `headless`, `stealth`, `userAgent`, `width`, `height` | `{ id, status, cdpPort }` |
| `navigate` | `url` | `sessionId`, `waitUntil`, `timeout` | `{ url, title }` |
| `scrape` | `url` | `sessionId`, `format` (`text`\|`html`), `waitForSelector` | `{ content, title, url }` |
| `screenshot` | — | `sessionId`, `fullPage` | base64 `image/png` content block |
| `click` | `selector` | `sessionId`, `button`, `clickCount` | `{ success, selector }` |
| `type` | `selector`, `text` | `sessionId`, `delay` | `{ success, selector }` |
| `evaluate` | `script` | `sessionId` | the script's return value (script ≤ 100 KB) |
| `get_cookies` | — | `sessionId` | `{ cookies }` |
| `set_cookies` | `cookies` (array) | `sessionId` | `{ injected }` |
| `release` | — | `sessionId` | `{ id, status: "released" }` |

### Notes

- `navigate` and `scrape` block `file:`, `javascript:`, and `data:` URLs.
- `evaluate` enforces `ANVIL_EVALUATE_TIMEOUT_MS` via CDP `Runtime.terminateExecution`,
  so a runaway script is killed and the session stays usable.
- A typical flow: `create_session` → `navigate` → (`scrape` / `click` / `type` /
  `evaluate` / `screenshot`) → `release`.

## Relationship to the REST API

The MCP server and the REST API (`npm start`) are independent entry points over the
same `SessionActions` service. Sessions created via MCP are not visible to a
separately-running HTTP server and vice versa — each process owns its own
`SessionManager`. Run whichever surface fits the client.
