import { describe, it, expect, afterEach } from "vitest";
import { installProcessHandlers } from "../src/process-handlers.js";
import { type Logger } from "../src/logger.js";

// DEV-0069: installProcessHandlers registers REAL process listeners. Snapshot pre-existing ones and
// remove only what we added (afterEach), so a leaked unhandledRejection listener can't swallow other
// suites' failures. terminate() is async (awaits stop()), so after emitting we await a macrotask.

const EVENTS = ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"] as const;
const before: Record<string, Function[]> = {};
for (const e of EVENTS) before[e] = [...process.listeners(e)];

afterEach(() => {
  for (const e of EVENTS) {
    for (const l of process.listeners(e)) {
      if (!before[e].includes(l)) process.removeListener(e, l as (...a: unknown[]) => void);
    }
  }
});

function fakeLogger(sink: string[]): Logger {
  const push = (lvl: string) => (msg: string) => { sink.push(`${lvl}:${msg}`); };
  return { debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") } as Logger;
}

// Let the async terminate() (await stop() → exit) settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(stop: () => Promise<void>) {
  const logs: string[] = [];
  const exits: number[] = [];
  const stops = { n: 0 };
  installProcessHandlers({
    logger: fakeLogger(logs),
    stop: async () => { stops.n++; await stop(); },
    exit: (c) => exits.push(c),
  });
  return { logs, exits, stops };
}

describe("installProcessHandlers", () => {
  it("registers a listener on every managed event", () => {
    const base = EVENTS.map((e) => process.listenerCount(e));
    harness(async () => {});
    EVENTS.forEach((e, i) => expect(process.listenerCount(e)).toBe(base[i] + 1));
  });

  it("SIGTERM: stops then exits 0", async () => {
    const h = harness(async () => {});
    process.emit("SIGTERM");
    await flush();
    expect(h.stops.n).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  it("uncaughtException: logs error, stops, exits 1", async () => {
    const h = harness(async () => {});
    process.emit("uncaughtException", new Error("boom"));
    await flush();
    expect(h.logs.some((m) => m.startsWith("error:") && /uncaughtException/.test(m))).toBe(true);
    expect(h.stops.n).toBe(1);
    expect(h.exits).toEqual([1]);
  });

  it("unhandledRejection: stops, exits 1", async () => {
    const h = harness(async () => {});
    (process as NodeJS.EventEmitter).emit("unhandledRejection", "nope");
    await flush();
    expect(h.stops.n).toBe(1);
    expect(h.exits).toEqual([1]);
  });

  it("still exits when stop() throws (best-effort teardown)", async () => {
    const h = harness(async () => { throw new Error("pool stuck"); });
    process.emit("uncaughtException", new Error("boom"));
    await flush();
    expect(h.exits).toEqual([1]);
    expect(h.logs.some((m) => /stop\(\) failed/.test(m))).toBe(true);
  });

  it("is re-entrancy guarded: a second fatal does not stop/exit twice", async () => {
    const h = harness(async () => {});
    process.emit("uncaughtException", new Error("first"));
    process.emit("uncaughtException", new Error("second"));
    await flush();
    expect(h.stops.n).toBe(1);
    expect(h.exits).toEqual([1]);
  });
});
