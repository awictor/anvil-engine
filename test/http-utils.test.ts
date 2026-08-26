import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { resolveSession, readBody } from "../src/http-utils.js";
import type { SessionManager, Session } from "../src/session.js";

// DEV-0028 (HARDEN): http-utils resolveSession + readBody are used by EVERY route to target a
// session (X-Session-Id > ?sessionId= > active) and read/cap request bodies. Untested. Pin the
// precedence + error shapes + body cap so a refactor can't silently break session targeting.

// Minimal fake SessionManager: only get()/getActive() are used by resolveSession.
function fakeManager(byId: Record<string, Session>, active?: Session): SessionManager {
  return {
    get: (id: string) => byId[id],
    getActive: () => active,
  } as unknown as SessionManager;
}
const S = (id: string) => ({ id } as unknown as Session);

function reqWith(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}
const urlWith = (qs = "") => new URL(`http://x/v1/thing${qs}`);

describe("resolveSession precedence (DEV-0028)", () => {
  it("X-Session-Id header wins over query + active", () => {
    const mgr = fakeManager({ H: S("H"), Q: S("Q") }, S("A"));
    const r = resolveSession(mgr, reqWith({ "x-session-id": "H" }), urlWith("?sessionId=Q"));
    expect(r.session?.id).toBe("H");
  });

  it("?sessionId= wins over active when no header", () => {
    const mgr = fakeManager({ Q: S("Q") }, S("A"));
    const r = resolveSession(mgr, reqWith(), urlWith("?sessionId=Q"));
    expect(r.session?.id).toBe("Q");
  });

  it("falls back to the active session when neither header nor query given", () => {
    const mgr = fakeManager({}, S("A"));
    const r = resolveSession(mgr, reqWith(), urlWith());
    expect(r.session?.id).toBe("A");
  });

  it("an explicit but unknown id -> 404 Session not found (does NOT fall back to active)", () => {
    const mgr = fakeManager({}, S("A"));
    const r = resolveSession(mgr, reqWith({ "x-session-id": "nope" }), urlWith());
    expect(r.session).toBeUndefined();
    expect(r.error).toEqual({ status: 404, body: { error: "Session not found" } });
  });

  it("no explicit id and no active -> 400 No active session", () => {
    const mgr = fakeManager({});
    const r = resolveSession(mgr, reqWith(), urlWith());
    expect(r.error).toEqual({ status: 400, body: { error: "No active session" } });
  });
});

describe("readBody (DEV-0028)", () => {
  function reqFrom(data: string | Buffer): IncomingMessage {
    const r = Readable.from([typeof data === "string" ? Buffer.from(data) : data]);
    return r as unknown as IncomingMessage;
  }

  it("resolves the full body string", async () => {
    expect(await readBody(reqFrom('{"a":1}'))).toBe('{"a":1}');
  });

  it("resolves empty string for an empty body", async () => {
    expect(await readBody(reqFrom(""))).toBe("");
  });

  it("rejects a body over the 1MB cap", async () => {
    const big = Buffer.alloc(1_048_577, 0x61); // 1MB + 1
    await expect(readBody(reqFrom(big))).rejects.toThrow(/too large/i);
  });
});
