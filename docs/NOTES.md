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
- `sessions` → `test/sessions-contract.test.ts` (DEV-0170: routing shape + the 201 create-body key-set
  {id,status,websocketUrl,cdpPort,createdAt} that relay anvil.ts:64 + mcp-forge both parse — the
  highest-traffic consumer contract); `actions`/`content`/`health` also boot via `test/integration/server.test.ts`
- `/v1/docs` CATALOG → `test/docs-count-drift.test.ts`: three guards, weak→strong — count (0171,
  declared endpoints === registered route count), path-SET both-ways (0172, catches a missing/phantom
  route), method+path TUPLE (0173, catches a verb flip GET↔POST on a shared path). LESSON: count-equality
  is a weak invariant (0171's 38 hid 2 missing routes), set-equality catches contents, tuple catches verbs.

So routing-shape + the docs catalog are saturated + drift-guarded: future anvil work should be
behavior/feature/bugfix, not more shape tests.

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
- **THREE error classifiers exist by design — do NOT unify them (different error domains):**
  1. `isCrashError` (browser-helper.ts) — puppeteer CONNECTION crashes (Target/Session closed, Protocol
     error) → relaunch.
  2. `isTransientNavError` (actions.ts, m12) — page NAVIGATION errors (timeout/net::ERR_/5xx; NOT
     ERR_ABORTED / invalid-URL / Blocked protocol) → retry `navigate`.
  3. `isTransientError` (the shared `lib/anvil-client.ts`, m13, canonical in Relay) — HTTP/CONNECT +
     SSRF taxonomy (NOT Blocked URL/protocol/hostname/IP) → retry the anvil-client fetch.
  Each guards a distinct call site (connect vs page-nav vs http-fetch); merging them would retry the
  wrong things. Tested in `browser-helper.test.ts` / `nav-retry.test.ts` / the anvil-client suites.

## HTTP error taxonomy (`errorToResponse`, `src/middleware.ts`)

- The app-wide catch (`app.ts`) funnels every thrown handler error through `errorToResponse(err)` →
  `{ status, body }`. This is the CONTRACT callers (relay, DataFaucet) key retry/alerting off, so keep
  it exhaustive: one status per real failure class, and never let a 5xx swallow a client fault.
- Mapping, in ternary order (client-4xx first, then upstream 5xx, then generic). CLIENT 4xx: bad JSON
  body → **400** (DEV-0119); `Blocked protocol/URL` → **400** (DEV-0120, SSRF); page index `out of range`
  → **400** (DEV-0153); bad proxy — `Unsupported proxy scheme` / `is private or internal and not allowed`
  (launcher.validateProxyUrl, SSRF host-guard) → **400** (DEV-0181); `Cannot close the last remaining`
  page → **409** conflict (DEV-0153); `limit reached` (per-session tab cap) → **429** (DEV-0152). UPSTREAM
  5xx: Playwright timeout (`TimeoutError` / `Timeout <n>ms exceeded` / `timed out after <n>ms`) → **504**
  (DEV-0145); browser-crash disconnect (reuses `isCrashError`/`CRASH_PATTERNS`) → **502** (DEV-0146);
  `Chrome CDP did not start on port <p> within <t>ms` (transient launch-capacity, launcher.ts:233) →
  **503** retry-later (DEV-0182, PENDING). SIZE/EXISTENCE: `too large` → **413**; `not found` → **404**.
  Else → **500**.
- WHY it matters: a blanket 500 for an EXPECTED browser event (page timeout, crash, tab-cap, bad proxy,
  launch blip) reads as an anvil OUTAGE to a dependent caller and triggers false alerts / aggressive
  retries. Pin every REAL throw phrase (read the actual `src/*.ts` literal, DEV-0154 style) + a negative
  (generic stays 500) in `middleware.test.ts` when editing — a reworded throw must fail CI, not silently
  revert to 500.
- Metrics split (DEV-0147): `recordRequest` bumps `errorsCount` on every ≥400 but `serverErrorsCount`
  only on ≥500 — the latter is the true-outage signal the heartbeat/alerting keys off, so a burst of
  client 4xx (400/404/429) can't fake an outage.

## Session lifecycle + leak visibility (`src/session.ts`)

- One shared anvil serves BOTH relay + DataFaucet; a leaked/stuck session starves both, so lifecycle
  correctness is load-bearing. Key invariants:
- `inFlight` per session: `beginRequest`/`endRequest` bracket every browser op in `actions.ts run()`
  (finally-decrement). `destroy()` drains inFlight (5s grace) before killing.
- The idle reaper (`sweepIdle(now, timeoutMs)`, called every 30s by `startCleanup`) **skips any session
  with `inFlight > 0`** (DEV-0156) — an in-flight op is NOT idle; without the guard a long action gets
  its browser force-killed mid-flight. `sweepIdle` is extracted (returns reaped ids) so it's unit-testable
  without timers/a real browser (seed `(mgr as any).sessions`, use a fake pool so `destroy` releases).
- CONSEQUENCE: a session stuck at `inFlight>0` is now un-reapable, so it must be VISIBLE.
  `lifecycleStats(now)` → `{inFlightTotal, oldestAgeMs, oldestIdleMs}` feeds `/v1/metrics`
  (+ heartbeat `inFlightTotal`); `list()` rows carry per-session `idleMs`+`inFlight` for culprit triage.
  A growing `inFlightTotal`/oldest-age is the early-warning BEFORE the pool starves.
