import { describe, it, expect, vi } from "vitest";
import { makeMetricsHeartbeat } from "../src/metrics-heartbeat.js";

// DEV-0112: wall-clock ops heartbeat. Injectable setInterval/clearInterval so we drive it with a
// captured callback — no real timers.

function fakeTimer() {
  let fn: (() => void) | null = null;
  const setInterval = (f: () => void, _ms: number) => { fn = f; return 1 as unknown; };
  const clearInterval = (_h: unknown) => { fn = null; };
  return { setInterval, clearInterval, fire: () => fn?.(), get armed() { return fn !== null; } };
}

describe("makeMetricsHeartbeat (DEV-0112)", () => {
  it("emits on each interval fire", () => {
    const t = fakeTimer();
    let emits = 0;
    const hb = makeMetricsHeartbeat({ emit: () => emits++, periodMs: 60000, setInterval: t.setInterval, clearInterval: t.clearInterval });
    hb.start();
    expect(t.armed).toBe(true);
    t.fire(); t.fire();
    expect(emits).toBe(2);
  });

  it("stop() clears the interval (no further fires)", () => {
    const t = fakeTimer();
    let emits = 0;
    const hb = makeMetricsHeartbeat({ emit: () => emits++, periodMs: 60000, setInterval: t.setInterval, clearInterval: t.clearInterval });
    hb.start();
    t.fire();
    hb.stop();
    expect(t.armed).toBe(false);
    expect(emits).toBe(1);
  });

  it("periodMs <= 0 disables (never arms — the default-off deploy)", () => {
    const t = fakeTimer();
    const hb = makeMetricsHeartbeat({ emit: () => {}, periodMs: 0, setInterval: t.setInterval, clearInterval: t.clearInterval });
    hb.start();
    expect(t.armed).toBe(false);
  });

  it("start() is idempotent — no stacked second timer", () => {
    const spy = vi.fn((_f: () => void, _ms: number) => 1 as unknown);
    const hb = makeMetricsHeartbeat({ emit: () => {}, periodMs: 1000, setInterval: spy, clearInterval: () => {} });
    hb.start();
    hb.start();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a throwing emit routes to onError and does NOT stop the beat", () => {
    const t = fakeTimer();
    const errs: unknown[] = [];
    const hb = makeMetricsHeartbeat({
      emit: () => { throw new Error("log pipe broke"); },
      periodMs: 1000, onError: (e) => errs.push(e),
      setInterval: t.setInterval, clearInterval: t.clearInterval,
    });
    hb.start();
    t.fire(); t.fire();
    expect(errs.length).toBe(2);
    expect(t.armed).toBe(true); // survives
  });
});
