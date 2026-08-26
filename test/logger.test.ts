import { describe, it, expect, afterEach, vi } from "vitest";
import { createLogger } from "../src/logger.js";

// HARDEN: logger.ts is used by every route + recordRequest + the metrics heartbeat, but had no direct
// test. It's a structured JSON logger with ANVIL_LOG_LEVEL gating (debug<info<warn<error), a module
// tag, field-merge, and a stderr sink. A flipped level compare or a lost field would silence/garble
// ops logs everywhere. Capture process.stderr.write; no real logging side effects.

function capture() {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, spy, json: () => lines.map((l) => JSON.parse(l)) };
}

const OLD = process.env.ANVIL_LOG_LEVEL;
afterEach(() => {
  vi.restoreAllMocks();
  if (OLD === undefined) delete process.env.ANVIL_LOG_LEVEL;
  else process.env.ANVIL_LOG_LEVEL = OLD;
});

describe("createLogger", () => {
  it("emits a structured JSON line with ts/level/module/msg + merged fields", () => {
    process.env.ANVIL_LOG_LEVEL = "info";
    const c = capture();
    createLogger("app").info("started", { requestId: "r1", port: 3000 });
    expect(c.lines.length).toBe(1);
    const obj = c.json()[0];
    expect(obj).toMatchObject({ level: "info", module: "app", msg: "started", requestId: "r1", port: 3000 });
    expect(typeof obj.ts).toBe("string"); // ISO timestamp present
    expect(c.lines[0].endsWith("\n")).toBe(true); // newline-delimited
  });

  it("suppresses a level below the active threshold (debug < info default)", () => {
    process.env.ANVIL_LOG_LEVEL = "info";
    const c = capture();
    const log = createLogger("app");
    log.debug("noisy");   // below info -> dropped
    log.info("kept");
    expect(c.lines.length).toBe(1);
    expect(c.json()[0].msg).toBe("kept");
  });

  it("ANVIL_LOG_LEVEL=error suppresses info + warn, keeps error", () => {
    process.env.ANVIL_LOG_LEVEL = "error";
    const c = capture();
    const log = createLogger("app");
    log.info("i"); log.warn("w"); log.error("e");
    expect(c.json().map((o) => o.level)).toEqual(["error"]);
  });

  it("ANVIL_LOG_LEVEL=debug lets everything through", () => {
    process.env.ANVIL_LOG_LEVEL = "debug";
    const c = capture();
    const log = createLogger("app");
    log.debug("d"); log.info("i"); log.warn("w"); log.error("e");
    expect(c.lines.length).toBe(4);
  });

  it("an unknown ANVIL_LOG_LEVEL falls back to info (not silence)", () => {
    process.env.ANVIL_LOG_LEVEL = "chatty";
    const c = capture();
    const log = createLogger("app");
    log.debug("d"); // still below info -> dropped
    log.info("i");
    expect(c.json().map((o) => o.msg)).toEqual(["i"]);
  });

  it("works with no fields argument", () => {
    process.env.ANVIL_LOG_LEVEL = "info";
    const c = capture();
    createLogger("mod").warn("bare");
    expect(c.json()[0]).toMatchObject({ level: "warn", module: "mod", msg: "bare" });
  });
});
