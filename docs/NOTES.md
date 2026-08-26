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

## Consumer contract (relay + DataFaucet)

- `/v1/view` + `/v1/view/stream` are **read-only** (GET-only) JPEG/MJPEG — no click
  injection (unlike a Browserbase debugger). Drive interaction via `/v1/actions/*`.
- HAR capture flow: `POST /v1/har/start` → `/v1/actions/navigate` (+`/evaluate` for link
  discovery) → `POST /v1/har/stop` → `GET /v1/har`. HAR entries carry
  `responseContentType` + a bounded `responseBodyPreview` so a consumer classifies a JSON
  API endpoint from the capture alone (no re-fetch).
- `captureFrame(session, quality?)` routes quality through `normalizeQuality` (undefined/
  non-finite → default 60; clamp [1,100]; round). Never hand raw `?quality=` to Chrome.
