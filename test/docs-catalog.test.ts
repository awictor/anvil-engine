import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
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
});
