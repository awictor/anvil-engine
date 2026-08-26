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

  // DEV-0009: a multi-byte char straddling the cap boundary must NOT produce a U+FFFD mojibake tail.
  it("never emits a broken char when the cap lands mid-multibyte (multibyte-safe)", () => {
    // "aaé" = 4 bytes (é = 2 bytes: C3 A9). Cap at 3 splits the é.
    const buf = Buffer.from("aaé", "utf8");
    expect(buf.length).toBe(4);
    const r = harResponseFields({ "content-type": "text/plain" }, buf, 3);
    // The naive buffer.subarray(0,3).toString("utf8") gives "aa�"; StringDecoder drops the
    // incomplete é entirely -> "aa". Either way, NO replacement char.
    expect(r.responseBodyPreview).toBe("aa");
    expect(r.responseBodyPreview).not.toContain("�");
  });

  it("keeps a whole multibyte char that fits within the cap", () => {
    const buf = Buffer.from("aaé", "utf8"); // 4 bytes
    const r = harResponseFields({ "content-type": "text/plain" }, buf, 4);
    expect(r.responseBodyPreview).toBe("aaé");
  });

  it("a 3-byte char (emoji component / CJK) split at the boundary is dropped cleanly", () => {
    const buf = Buffer.from("x世", "utf8"); // 世 = 3 bytes; total 4
    const r = harResponseFields({ "content-type": "text/plain" }, buf, 2); // cap mid-世
    expect(r.responseBodyPreview).toBe("x");
    expect(r.responseBodyPreview).not.toContain("�");
  });
});
