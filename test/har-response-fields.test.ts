import { describe, it, expect } from "vitest";
import { harResponseFields } from "../src/actions.js";

// DEV-0006: HAR entries now carry response content-type + a capped body preview so a consumer
// (DataFaucet capture) can classify a JSON API endpoint from the capture alone, no re-fetch.
describe("harResponseFields", () => {
  it("tags a JSON response by content-type (case-insensitive)", () => {
    const a = harResponseFields({ "content-type": "application/json; charset=utf-8" }, Buffer.from("{}"), 2048);
    expect(a.responseContentType).toBe("application/json; charset=utf-8");
    // servers send either casing — must still be picked up
    const b = harResponseFields({ "Content-Type": "application/json" }, Buffer.from("{}"), 2048);
    expect(b.responseContentType).toBe("application/json");
  });

  it("includes a UTF-8 body preview up to the cap", () => {
    const body = Buffer.from(JSON.stringify({ id: 1, name: "x" }));
    const r = harResponseFields({ "content-type": "application/json" }, body, 2048);
    expect(r.responseBodyPreview).toBe('{"id":1,"name":"x"}');
  });

  it("caps a large body at capBytes (no HAR bloat)", () => {
    const big = Buffer.from("A".repeat(10_000));
    const r = harResponseFields({ "content-type": "text/plain" }, big, 2048);
    expect(r.responseBodyPreview).toBeDefined();
    expect(r.responseBodyPreview!.length).toBe(2048);
  });

  it("cap=0 disables the preview (but content-type still recorded)", () => {
    const r = harResponseFields({ "content-type": "application/json" }, Buffer.from("{}"), 0);
    expect(r.responseBodyPreview).toBeUndefined();
    expect(r.responseContentType).toBe("application/json");
  });

  it("empty body -> no preview", () => {
    const r = harResponseFields({ "content-type": "application/json" }, Buffer.alloc(0), 2048);
    expect(r.responseBodyPreview).toBeUndefined();
  });

  it("no content-type header -> undefined (not a crash)", () => {
    const r = harResponseFields({}, Buffer.from("hi"), 2048);
    expect(r.responseContentType).toBeUndefined();
    expect(r.responseBodyPreview).toBe("hi");
  });
});
