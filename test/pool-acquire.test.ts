import { describe, it, expect, vi, beforeEach } from "vitest";

// DEV-0071: exercise BrowserPool.acquire's real paths — the warm-pop shortcut and the cold
// launch-vs-timeout race — WITHOUT launching real Chrome. Mock the launcher module so acquire()
// resolves against a fake proc. The key regression guard (DEV-0070): a cold acquire must resolve
// promptly and NOT leave the 30s timeout timer pending (which would hold the event loop / hang the
// suite). vitest's fake timers assert no timer survives the settled race.

const fakeProc = { pid: 1, cdpPort: 9222, wsEndpoint: "ws://x", process: null } as any;
const launchBrowser = vi.fn(async () => fakeProc);
const killBrowser = vi.fn(async () => {});

vi.mock("../src/launcher.js", () => ({
  launchBrowser: (...a: unknown[]) => launchBrowser(...a),
  killBrowser: (...a: unknown[]) => killBrowser(...a),
}));

const { BrowserPool } = await import("../src/pool.js");

beforeEach(() => {
  launchBrowser.mockClear();
  killBrowser.mockClear();
});

describe("BrowserPool.acquire (DEV-0071)", () => {
  it("returns a warm proc without launching", async () => {
    const pool = new BrowserPool(1);
    // seed a warm proc via init (launch stubbed)
    await pool.init();
    expect(pool.available).toBe(1);
    launchBrowser.mockClear();
    const proc = await pool.acquire();
    expect(proc).toBe(fakeProc);
    expect(launchBrowser).not.toHaveBeenCalled(); // came from warm.pop()
    expect(pool.available).toBe(0);
  });

  it("cold acquire launches and resolves — and clears the timeout timer (no dangling timer)", async () => {
    vi.useFakeTimers();
    try {
      const pool = new BrowserPool(0); // no warm procs -> cold path
      const p = pool.acquire();
      await vi.runAllTimersAsync(); // let the launch microtask + any timers settle
      const proc = await p;
      expect(proc).toBe(fakeProc);
      expect(launchBrowser).toHaveBeenCalledTimes(1);
      // The 30s timeout timer must have been cleared by acquire's finally — nothing left pending.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cold acquire rejects if the launch stalls past the 30s cap", async () => {
    vi.useFakeTimers();
    try {
      launchBrowser.mockImplementationOnce(() => new Promise(() => {})); // never resolves
      const pool = new BrowserPool(0);
      const p = pool.acquire();
      const assertion = expect(p).rejects.toThrow(/timed out after 30s/);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  // HARDEN: init() uses Promise.allSettled, so a FLAKY launch (some reject) must not throw — the pool
  // just warms fewer procs. Nothing tested the partial-failure path; a naive Promise.all rewrite would
  // reject the whole init and take the server down on one bad Chrome spawn.
  it("init tolerates partial launch failure (allSettled — warms only the successes)", async () => {
    launchBrowser.mockReset();
    launchBrowser
      .mockResolvedValueOnce(fakeProc)
      .mockRejectedValueOnce(new Error("chrome spawn EACCES"))
      .mockResolvedValueOnce(fakeProc);
    const pool = new BrowserPool(3);
    await pool.init(); // must NOT throw despite the middle rejection
    expect(pool.available).toBe(2); // only the two fulfilled launches warmed
    launchBrowser.mockReset();
    launchBrowser.mockImplementation(async () => fakeProc);
  });

  // HARDEN: shutdown kills every warm proc and empties the pool; a second shutdown is a no-op (not a
  // double-kill crash). release() hands the proc to killBrowser.
  it("shutdown kills all warm procs, is idempotent, and release kills a proc", async () => {
    const pool = new BrowserPool(2);
    await pool.init();
    expect(pool.available).toBe(2);
    killBrowser.mockClear();
    await pool.shutdown();
    expect(killBrowser).toHaveBeenCalledTimes(2);
    expect(pool.available).toBe(0);
    await pool.shutdown(); // idempotent — no warm procs, no extra kills
    expect(killBrowser).toHaveBeenCalledTimes(2);

    killBrowser.mockClear();
    pool.release(fakeProc);
    expect(killBrowser).toHaveBeenCalledWith(fakeProc);
  });
});
