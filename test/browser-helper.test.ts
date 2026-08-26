import { describe, it, expect } from "vitest";
import { isCrashError } from "../src/browser-helper.js";

// DEV-0033: isCrashError gates withBrowser's one-shot relaunch-and-retry. A crash-shaped error
// (Target/Session closed, Protocol error, WS not open, ECONNREFUSED, disconnected) must be true so
// the browser relaunches; a real app error must be false so it propagates. Misclass = wasted
// relaunch or a dropped retryable crash. Pin every pattern + the negatives.

describe("isCrashError (DEV-0033)", () => {
  it("returns true for each crash pattern (case-insensitive)", () => {
    for (const m of [
      "Target closed",
      "Session closed unexpectedly",
      "Protocol error (Runtime.evaluate): Target closed",
      "WebSocket is not open: readyState 3",
      "connect ECONNREFUSED 127.0.0.1:9222",
      "browser has disconnected",
      "Browser connection failed (session may have crashed): x",
      "TARGET CLOSED", // case-insensitive
    ]) {
      expect(isCrashError(new Error(m)), m).toBe(true);
    }
  });

  it("returns false for a normal application error (must propagate, not relaunch)", () => {
    for (const m of ["Element not found", "boom", "Navigation timeout of 30000 ms exceeded", "Blocked URL: private IP"]) {
      expect(isCrashError(new Error(m)), m).toBe(false);
    }
  });

  it("returns false for a non-Error value", () => {
    expect(isCrashError("Target closed")).toBe(false); // a bare string, not an Error
    expect(isCrashError(undefined)).toBe(false);
    expect(isCrashError(null)).toBe(false);
    expect(isCrashError({ message: "Target closed" })).toBe(false); // not an Error instance
  });
});
