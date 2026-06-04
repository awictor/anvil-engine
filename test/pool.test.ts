import { describe, it, expect } from "vitest";
import { BrowserPool } from "../src/pool.js";
import { SessionManager } from "../src/session.js";

describe("BrowserPool", () => {
  it("can be instantiated with default size", () => {
    const pool = new BrowserPool();
    expect(pool.size).toBe(3);
    expect(pool.available).toBe(0);
  });

  it("can be instantiated with custom size", () => {
    const pool = new BrowserPool(5);
    expect(pool.size).toBe(5);
  });

  it("starts with 0 available (before init)", () => {
    const pool = new BrowserPool(2);
    expect(pool.available).toBe(0);
  });

  it("exports acquire, release, init, shutdown methods", () => {
    const pool = new BrowserPool(1);
    expect(typeof pool.acquire).toBe("function");
    expect(typeof pool.release).toBe("function");
    expect(typeof pool.init).toBe("function");
    expect(typeof pool.shutdown).toBe("function");
  });
});

describe("SessionManager with pool", () => {
  it("accepts optional pool in constructor", () => {
    const pool = new BrowserPool(1);
    const mgr = new SessionManager(pool);
    expect(mgr.size).toBe(0);
  });

  it("works without pool (backward compatible)", () => {
    const mgr = new SessionManager();
    expect(mgr.size).toBe(0);
    expect(mgr.list()).toEqual([]);
  });
});

describe("ANVIL_POOL_SIZE env integration", () => {
  it("pool size 0 means no pool (default)", () => {
    const size = Number("0") || 0;
    const pool = size > 0 ? new BrowserPool(size) : undefined;
    expect(pool).toBeUndefined();
  });

  it("pool size > 0 creates pool", () => {
    const size = Number("3") || 0;
    const pool = size > 0 ? new BrowserPool(size) : undefined;
    expect(pool).toBeDefined();
    expect(pool!.size).toBe(3);
  });
});
