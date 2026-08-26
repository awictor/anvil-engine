import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "../src/router.js";
import { sessionRoutes } from "../src/routes/sessions.js";
import { actionRoutes } from "../src/routes/actions.js";
import { contentRoutes } from "../src/routes/content.js";
import { networkRoutes } from "../src/routes/network.js";
import { recordingRoutes } from "../src/routes/recording.js";
import { downloadRoutes } from "../src/routes/downloads.js";
import { pageRoutes } from "../src/routes/pages.js";
import { contextRoutes } from "../src/routes/contexts.js";
import { viewRoutes } from "../src/routes/view.js";
import { healthRoutes } from "../src/routes/health.js";
import type { Deps } from "../src/routes/deps.js";

// DEV-0102 (HARDEN): GET /v1/docs advertises a `categories` catalog of { method, path } for every
// endpoint. health.test only guards the COUNT (endpoints === summed catalog); nothing proved each
// advertised route actually RESOLVES in the Router. A renamed/removed route (e.g. /v1/scrape ->
// /v1/extract) would leave /v1/docs lying to every consumer. Build the real router from all route
// groups and assert every catalog { method, path } matches — with :params filled by a token.

// Route groups only read deps at REQUEST time (handlers), never at registration, so a bare stub is
// enough to enumerate patterns. Same trick the contract suites use (docs/NOTES.md "Route-contract").
const stub = { config: { sessionTimeoutMs: 300000, maxSessions: 10, poolSize: 2 } } as unknown as Deps;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function fullRouter(): Router {
  const r = new Router();
  r.addAll(sessionRoutes(stub));
  r.addAll(actionRoutes(stub));
  r.addAll(contentRoutes(stub));
  r.addAll(networkRoutes(stub));
  r.addAll(recordingRoutes(stub));
  r.addAll(downloadRoutes(stub));
  r.addAll(pageRoutes(stub));
  r.addAll(contextRoutes(stub));
  r.addAll(viewRoutes(stub));
  r.addAll(healthRoutes(stub));
  return r;
}

// The raw route list (method + pattern) from every group — used to check catalog COMPLETENESS.
function allRoutes(): { method: string; pattern: string }[] {
  return [
    ...sessionRoutes(stub), ...actionRoutes(stub), ...contentRoutes(stub), ...networkRoutes(stub),
    ...recordingRoutes(stub), ...downloadRoutes(stub), ...pageRoutes(stub), ...contextRoutes(stub),
    ...viewRoutes(stub), ...healthRoutes(stub),
  ].map((r) => ({ method: r.method, pattern: r.pattern }));
}

// Operational probes deliberately EXCLUDED from the public /v1/docs catalog (health.ts comment:
// "operational endpoint — not part of the ... public API catalog"). Anything else must be documented.
const CATALOG_EXCLUDE = new Set(["GET /v1/live", "GET /v1/ready"]);

// Minimal ServerResponse stand-in (same shape as health.test): captures writeHead + JSON body.
function mkRes() {
  const chunks: Buffer[] = [];
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  (res as any).headersSent = false;
  (res as any).writeHead = () => { (res as any).headersSent = true; return res; };
  return { res: res as any, get json() { return JSON.parse(Buffer.concat(chunks).toString()); } };
}

type CatalogEntry = { method: string; path: string; description: string };

function readCatalog(): CatalogEntry[] {
  const docs = healthRoutes(stub).find((r) => r.pattern === "/v1/docs")!;
  const r = mkRes();
  docs.handler({ req: {} as any, res: r.res, url: new URL("http://x/"), params: {}, requestId: "t" });
  const cats = r.json.categories as Record<string, CatalogEntry[]>;
  return Object.values(cats).flat();
}

// A concrete pathname the Router can match: fill each ":name" segment with a placeholder token.
function concrete(path: string): string {
  return path.split("/").map((seg) => (seg.startsWith(":") ? "PLACEHOLDER" : seg)).join("/");
}

describe("GET /v1/docs catalog vs the real Router (DEV-0102)", () => {
  it("every advertised { method, path } resolves in the router", () => {
    const router = fullRouter();
    const catalog = readCatalog();
    expect(catalog.length).toBeGreaterThan(0);

    const missing = catalog.filter((e) => router.match(e.method, concrete(e.path)) === null);
    expect(missing, `docs advertise routes the router does not serve: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("catalog paths are unique per method (no accidental dupes in the self-doc)", () => {
    const catalog = readCatalog();
    const keys = catalog.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size, "duplicate method+path in /v1/docs catalog").toBe(keys.length);
  });

  // DEV-0103: README.md hardcodes "(N endpoints)" next to GET /v1/docs. That's a THIRD hand-typed
  // number (README literal, /v1/docs `endpoints` literal, summed catalog). DEV-0102 tied the docs
  // literal to the catalog; this ties the README literal too, so all three move together.
  it("README `(N endpoints)` equals the summed /v1/docs catalog", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const m = readme.match(/\((\d+)\s+endpoints\)/);
    expect(m, 'README.md has a "(N endpoints)" claim').not.toBeNull();
    expect(Number(m![1]), "README endpoint count vs live catalog").toBe(readCatalog().length);
  });

  // DEV-0123: the REVERSE of the resolves guard — every public Router route must be DOCUMENTED in
  // the catalog (minus the operational-probe exclude set). Catches a new public route shipped
  // without a /v1/docs entry, so a consumer never learns of it.
  it("every public Router route appears in the /v1/docs catalog (minus operational probes)", () => {
    // Normalize a rest-capture segment (`*name`) to the param form (`:name`) the catalog documents —
    // both denote "a param here"; the catalog uses `:filename` where the router uses `*filename`.
    const norm = (p: string) => p.replace(/\/\*/g, "/:");
    const documented = new Set(readCatalog().map((e) => `${e.method} ${norm(e.path)}`));
    const undocumented = allRoutes()
      .map((r) => `${r.method} ${norm(r.pattern)}`)
      .filter((k) => !CATALOG_EXCLUDE.has(k) && !documented.has(k));
    expect(undocumented, `public routes missing from /v1/docs catalog: ${JSON.stringify(undocumented)}`).toEqual([]);
  });
});
