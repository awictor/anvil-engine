import { describe, it, expect } from "vitest";
import { isTransientNavError, formatOpLog } from "../src/actions.js";

describe("formatOpLog (m12 anvil-oplog)", () => {
  it("emits session/op/ok/ms, clamps + rounds ms, no payloads", () => {
    expect(formatOpLog("sess-1", "navigate", true, 123.7)).toEqual({ anvil: "op", session: "sess-1", op: "navigate", ok: true, ms: 124 });
    expect(formatOpLog("s", "scrape", false, -5)).toEqual({ anvil: "op", session: "s", op: "scrape", ok: false, ms: 0 });
  });
});

// m12 anvil-retry-1: nav-error classifier (drives navigate()'s one-retry). Mirrors Relay's
// isTransientError taxonomy — transient errors retry, deterministic ones fail fast.
describe("isTransientNavError", () => {
  it("transient: timeouts, resets, Chrome net:: errors, 5xx-ish nav", () => {
    for (const m of [
      "Navigation timeout of 30000 ms exceeded",
      "net::ERR_CONNECTION_RESET at https://x.com",
      "net::ERR_NAME_NOT_RESOLVED",
      "ECONNRESET",
      "socket hang up",
      "Navigation failed because browser has disconnected",
      "frame was detached",
      "upstream returned 503",
    ]) expect(isTransientNavError(new Error(m)), m).toBe(true);
  });

  it("deterministic: blocked protocol / invalid url / aborted -> no retry", () => {
    for (const m of [
      "Blocked protocol: only http/https allowed",
      "Only http/https URLs supported",
      "Navigation to invalid URL",
      "net::ERR_ABORTED",
    ]) expect(isTransientNavError(new Error(m)), m).toBe(false);
  });

  it("accepts a non-Error value", () => {
    expect(isTransientNavError("Navigation timeout")).toBe(true);
    expect(isTransientNavError("Blocked protocol: file:")).toBe(false);
  });
});
