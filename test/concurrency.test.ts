import { describe, it, expect } from "vitest";
import { SessionManager, type Session } from "../src/session.js";
import { safeJoin, isSafeFilename } from "../src/path-safety.js";
import { sep } from "node:path";

// Concurrency + lifecycle invariants on the refcount/destroying machinery,
// using a fake browser process so no Chrome is required.

function fakeSession(manager: SessionManager, id = "fake-1"): Session {
  const session: Session = {
    id,
    status: "live",
    browserProcess: {
      pid: 12345,
      cdpPort: 9999,
      wsEndpoint: "ws://127.0.0.1:9999/devtools",
      process: {
        exitCode: 0,
        signalCode: null,
        killed: true,
        kill: () => true,
        once: () => {},
      } as never,
    },
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    options: {},
    inFlight: 0,
    destroying: false,
  };
  // Insert directly into the private map (test-only access)
  (manager as unknown as { sessions: Map<string, Session> }).sessions.set(id, session);
  return session;
}

describe("session refcount / destroy race", () => {
  it("beginRequest increments and endRequest decrements inFlight", () => {
    const manager = new SessionManager();
    const session = fakeSession(manager);
    expect(manager.beginRequest(session.id)).toBe(true);
    expect(session.inFlight).toBe(1);
    manager.endRequest(session.id);
    expect(session.inFlight).toBe(0);
  });

  it("beginRequest refuses work on a destroying session", () => {
    const manager = new SessionManager();
    const session = fakeSession(manager);
    session.destroying = true;
    expect(manager.beginRequest(session.id)).toBe(false);
    expect(session.inFlight).toBe(0);
  });

  it("beginRequest returns false for unknown sessions", () => {
    const manager = new SessionManager();
    expect(manager.beginRequest("ghost")).toBe(false);
  });

  it("destroy waits for in-flight operations to drain", async () => {
    const manager = new SessionManager();
    const session = fakeSession(manager);
    manager.beginRequest(session.id);

    let destroyed = false;
    const destroyPromise = manager.destroy(session.id).then((s) => {
      destroyed = true;
      return s;
    });

    // Destroy must not complete while a request is in flight
    await new Promise((r) => setTimeout(r, 150));
    expect(destroyed).toBe(false);
    expect(session.destroying).toBe(true);

    manager.endRequest(session.id);
    const result = await destroyPromise;
    expect(destroyed).toBe(true);
    expect(result?.status).toBe("released");
    expect(manager.get(session.id)).toBeUndefined();
  });

  it("double destroy is idempotent — second call returns undefined", async () => {
    const manager = new SessionManager();
    const session = fakeSession(manager);
    const [first, second] = await Promise.all([
      manager.destroy(session.id),
      manager.destroy(session.id),
    ]);
    const results = [first, second];
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("touch is a no-op on destroying sessions", () => {
    const manager = new SessionManager();
    const session = fakeSession(manager);
    const before = session.lastActivityAt;
    session.destroying = true;
    manager.touch(session.id);
    expect(session.lastActivityAt).toBe(before);
  });

  it("onDestroy hook fires with the session before removal", async () => {
    const manager = new SessionManager();
    const session = fakeSession(manager);
    let hookSession: Session | null = null;
    manager.onDestroy = (s) => {
      hookSession = s;
    };
    await manager.destroy(session.id);
    expect(hookSession).not.toBeNull();
    expect(hookSession!.id).toBe(session.id);
  });
});

describe("path-safety", () => {
  it("accepts plain filenames and resolves inside the dir", () => {
    const dir = sep === "\\" ? "C:\\tmp\\dl" : "/tmp/dl";
    const result = safeJoin(dir, "report.pdf");
    expect(result).not.toBeNull();
    expect(result!.endsWith(`${sep}report.pdf`)).toBe(true);
  });

  it("rejects forward-slash, backslash, and dotdot traversal", () => {
    const dir = sep === "\\" ? "C:\\tmp\\dl" : "/tmp/dl";
    expect(safeJoin(dir, "../etc/passwd")).toBeNull();
    expect(safeJoin(dir, "..\\..\\windows\\system32")).toBeNull();
    expect(safeJoin(dir, "a/b.txt")).toBeNull();
    expect(safeJoin(dir, "..")).toBeNull();
    expect(safeJoin(dir, "")).toBeNull();
  });

  it("rejects null bytes, newlines, and drive-colon names", () => {
    expect(isSafeFilename("file\0.txt")).toBe(false);
    expect(isSafeFilename("file\n.txt")).toBe(false);
    expect(isSafeFilename("C:evil.txt")).toBe(false);
    expect(isSafeFilename("good-name_1.2.txt")).toBe(true);
  });
});
