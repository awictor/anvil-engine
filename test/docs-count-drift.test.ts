import { describe, it, expect } from "vitest";
import type { Deps } from "../src/routes/deps.js";
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

// DEV-0171: /v1/docs advertises `endpoints: N` as a hardcoded literal, and a raw grep can't verify it
// (the docs block itself lists method:GET literals). Guard it at runtime: sum the ACTUAL registered
// route count across every group and assert it equals what the /v1/docs handler reports — so adding
// or removing a route without bumping the docs count fails CI. Extends the /v1 contract-stability focus.

const stub = {} as unknown as Deps;

function docsBody(): any {
  const route = healthRoutes(stub).find((r) => r.method === "GET" && r.pattern === "/v1/docs")!;
  let captured: any;
  const res = { writeHead() { return this; }, end(p?: string) { captured = p ? JSON.parse(p) : undefined; }, setHeader() {} } as any;
  route.handler({ req: {} as any, res, url: new URL("http://x/v1/docs"), params: {}, requestId: "t" } as any);
  return captured;
}

// Normalize a route pattern for set comparison: a trailing rest-capture `*name` and a param `:name`
// are the same catalog entry (downloads registers `/v1/downloads/*filename`, the catalog lists
// `/v1/downloads/:filename`). Collapse both `*seg`/`:seg` to `:seg`.
const norm = (p: string) => p.replace(/[:*](\w+)/g, ":$1");

const allRoutes = () => [
  ...sessionRoutes(stub), ...actionRoutes(stub), ...contentRoutes(stub), ...networkRoutes(stub),
  ...recordingRoutes(stub), ...downloadRoutes(stub), ...pageRoutes(stub), ...contextRoutes(stub),
  ...viewRoutes(stub), ...healthRoutes(stub),
];

describe("/v1/docs endpoint-count drift guard (DEV-0171)", () => {
  it("declared endpoints === actual registered route count", () => {
    expect(docsBody().endpoints).toBe(allRoutes().length);
  });

  // DEV-0172: a count match alone missed /v1/live + /v1/ready (right count, wrong contents once).
  // Assert the catalog PATH SET equals the registered pattern set both ways, so a missing OR phantom
  // catalog entry fails — not just a size mismatch.
  it("catalog path set === registered route pattern set (both directions)", () => {
    const registered = new Set(allRoutes().map((r) => norm(r.pattern)));
    const cats = docsBody().categories as Record<string, Array<{ path: string }>>;
    const catalog = new Set(Object.values(cats).flat().map((e) => norm(e.path)));
    const missingFromCatalog = [...registered].filter((p) => !catalog.has(p));
    const phantomInCatalog = [...catalog].filter((p) => !registered.has(p));
    expect(missingFromCatalog, "registered routes absent from /v1/docs catalog").toEqual([]);
    expect(phantomInCatalog, "/v1/docs lists routes that aren't registered").toEqual([]);
  });
});
