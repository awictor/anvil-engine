# anvil-engine — dev NOTES

Durable, reusable facts for anyone (or any loop) touching this repo. Keep terse.

## Router (`src/router.ts`)

- `Route = { method: string; pattern: string; handler }`. Patterns use `/` segments,
  `:name` for a param, trailing `*name` for a rest-capture.
- `new Router(); r.addAll(routes)` registers; **first-match-wins in registration order**.
- `r.match(method, pathname)` → `{ handler, params }` or `null`. Returns `null` when the
  method differs (a wrong verb is a 404, not a 405) or no pattern matches.
- Param match is by segment count: `DELETE /v1/contexts/:id` matches `/v1/contexts/abc`
  (`params.id === "abc"`) but NOT the bare `/v1/contexts` — a collection path never hits a
  `/:id` route. This is why "DELETE the collection" correctly 404s.

## Route-contract testing (offline, no browser)

Any route group is contract-testable without a live Chrome or `Deps`:

```ts
const stub = {} as unknown as Deps;          // handlers never run in a shape test
const r = new Router(); r.addAll(networkRoutes(stub));
r.match("GET", "/v1/har");                    // assert not null
r.match("POST", "/v1/har");                   // assert null (GET-only)
networkRoutes(stub).map(rt => `${rt.method} ${rt.pattern}`);  // assert exact set
```

**Coverage map — every `/v1` route group now has a contract test:**
- `view` → `test/view-contract.test.ts` (GET-only, read-only MJPEG)
- `network` (har/intercept) → `test/network-contract.test.ts`
- `contexts` + `pages` → `test/contexts-pages-contract.test.ts`
- `recording` → `test/recording.test.ts`; `downloads` → `test/downloads.test.ts`
- `sessions`/`actions`/`content`/`health` → `test/integration/server.test.ts` (boots real HTTP)

So routing-shape is saturated: future anvil work should be behavior/feature/bugfix, not
more shape tests.

## Unit gate vs e2e (what the CI gate does NOT cover)

Two test tiers, two configs:
- **Unit gate** — `npm test` (`vitest run`, `vitest.config.ts`) excludes `test/e2e/**`. It's the
  green-on-every-fire gate: route handlers via mock req/res, pure validation/config/util, contract
  shape. It NEVER launches a browser, so it does **not** prove any real-Chrome behavior.
- **e2e** — `npm run test:e2e` (`vitest.e2e.config.ts`, DEV-0086). The ONLY proof of real-browser
  guarantees: a session launches Chrome, `evaluate` returns real values, an `evaluate` timeout fires
  on `while(true)` and the session survives, `screenshot` returns real PNG bytes, HAR start/stop caps
  entries, concurrent evaluate+release drains cleanly, multi-page/contexts work, and a crash-relaunch
  keeps the download dir. Suites `describe.skipIf(!chromeAvailable())` — a "0 tests / skipped" result
  means Chrome wasn't found, NOT that it passed. Needs Chrome (set `CHROME_PATH` if not default).

If you change launcher/session/CDP/evaluate/screenshot/HAR behavior, the unit gate can be green while
the feature is broken — run `npm run test:e2e` (manual/owner, it's in `manual-qa.md`).

## Consumer contract (relay + DataFaucet)

- `/v1/view` + `/v1/view/stream` are **read-only** (GET-only) JPEG/MJPEG — no click
  injection (unlike a Browserbase debugger). Drive interaction via `/v1/actions/*`.
- HAR capture flow: `POST /v1/har/start` → `/v1/actions/navigate` (+`/evaluate` for link
  discovery) → `POST /v1/har/stop` → `GET /v1/har`. HAR entries carry
  `responseContentType` + a bounded `responseBodyPreview` so a consumer classifies a JSON
  API endpoint from the capture alone (no re-fetch).
- `captureFrame(session, quality?)` routes quality through `normalizeQuality` (undefined/
  non-finite → default 60; clamp [1,100]; round). Never hand raw `?quality=` to Chrome.

## Resilience: crash classification + relaunch (`src/browser-helper.ts`)

- `isCrashError(err)` = `err instanceof Error && CRASH_PATTERNS.test(err.message)`. Patterns
  (case-insensitive): `Target closed`, `Session closed`, `Protocol error`, `WebSocket is not
  open`, `connect ECONNREFUSED`, `browser has disconnected`, `Browser connection failed`.
  The `instanceof Error` guard is load-bearing: a bare string or `{message:...}` object → false.
- `withBrowser(wsEndpoint, fn, relaunch?)` connects, runs `fn(page, browser)`, disconnects in
  `finally`. On the FIRST attempt only, if `isCrashError` AND a `relaunch` cb is given, it
  relaunches (new endpoint) and retries once; any other error propagates immediately. So a real
  app error (element-not-found, timeout, `Blocked URL`) is NEVER retried — only a genuine crash.
- Relay mirrors this on the client side: `src/anvil.ts` `isTransientError` + `withRetry` gate a
  one-shot retry on transient anvil/network errors (5xx/timeout/reset), NOT on SSRF/4xx/Blocked.
  Two classifiers, same principle: a wrong bool = wasted retry or a dropped-recoverable failure.
  Both are regex-over-message — pin every phrase + a negative + a non-Error when editing either.
