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

function docsEndpointsField(): number {
  const route = healthRoutes(stub).find((r) => r.method === "GET" && r.pattern === "/v1/docs")!;
  let captured: any;
  const res = { writeHead() { return this; }, end(p?: string) { captured = p ? JSON.parse(p) : undefined; }, setHeader() {} } as any;
  route.handler({ req: {} as any, res, url: new URL("http://x/v1/docs"), params: {}, requestId: "t" } as any);
  return captured.endpoints;
}

describe("/v1/docs endpoint-count drift guard (DEV-0171)", () => {
  it("declared endpoints === actual registered route count", () => {
    const actual =
      sessionRoutes(stub).length + actionRoutes(stub).length + contentRoutes(stub).length +
      networkRoutes(stub).length + recordingRoutes(stub).length + downloadRoutes(stub).length +
      pageRoutes(stub).length + contextRoutes(stub).length + viewRoutes(stub).length +
      healthRoutes(stub).length;
    expect(docsEndpointsField()).toBe(actual);
  });
});
