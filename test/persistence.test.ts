import { describe, it, expect, afterEach } from "vitest";
import { rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  serializeSessions,
  deserializeSessions,
  toPersisted,
  loadPersisted,
  saveToDisk,
  restoreSessions,
  type PersistedSession,
} from "../src/persistence.js";

const SAVED_AT = 1_700_000_000_000;

function sample(): PersistedSession {
  return {
    id: "sess-1",
    options: { headless: true, width: 1280, height: 720, userAgent: "UA/1.0" },
    createdAt: 1_699_999_000_000,
    cookies: [
      { name: "sid", value: "abc", domain: ".example.com", path: "/", secure: true },
      { name: "pref", value: "dark", domain: ".example.com", path: "/" },
    ],
  };
}

describe("serialize / deserialize round-trip", () => {
  it("preserves id, options, createdAt, and cookies", () => {
    const original = [sample()];
    const json = serializeSessions(original, SAVED_AT);
    const restored = deserializeSessions(json);
    expect(restored).toEqual(original);
  });

  it("round-trips an empty list", () => {
    const json = serializeSessions([], SAVED_AT);
    expect(deserializeSessions(json)).toEqual([]);
  });

  it("embeds a version and savedAt in the envelope", () => {
    const json = serializeSessions([sample()], SAVED_AT);
    const envelope = JSON.parse(json);
    expect(envelope.version).toBe(1);
    expect(envelope.savedAt).toBe(SAVED_AT);
    expect(Array.isArray(envelope.sessions)).toBe(true);
  });
});

describe("deserialize tolerance", () => {
  it("returns [] for malformed JSON", () => {
    expect(deserializeSessions("{not json")).toEqual([]);
    expect(deserializeSessions("")).toEqual([]);
    expect(deserializeSessions("null")).toEqual([]);
    expect(deserializeSessions("42")).toEqual([]);
  });

  it("returns [] for a version mismatch", () => {
    const json = JSON.stringify({ version: 99, savedAt: SAVED_AT, sessions: [sample()] });
    expect(deserializeSessions(json)).toEqual([]);
  });

  it("returns [] when sessions is missing or not an array", () => {
    expect(deserializeSessions(JSON.stringify({ version: 1, savedAt: SAVED_AT }))).toEqual([]);
    expect(deserializeSessions(JSON.stringify({ version: 1, savedAt: SAVED_AT, sessions: {} }))).toEqual([]);
  });

  it("skips entries missing required fields but keeps valid ones", () => {
    const json = JSON.stringify({
      version: 1,
      savedAt: SAVED_AT,
      sessions: [
        { id: "ok", createdAt: 123, options: {}, cookies: [] },
        { id: 42, createdAt: 123 }, // bad id
        { createdAt: 123 }, // missing id
        { id: "no-createdat" }, // missing createdAt
        null,
        "garbage",
      ],
    });
    const restored = deserializeSessions(json);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe("ok");
  });

  it("defaults options to {} and cookies to [] when absent", () => {
    const json = JSON.stringify({
      version: 1,
      savedAt: SAVED_AT,
      sessions: [{ id: "x", createdAt: 1 }],
    });
    const restored = deserializeSessions(json);
    expect(restored[0].options).toEqual({});
    expect(restored[0].cookies).toEqual([]);
  });
});

describe("toPersisted", () => {
  it("extracts id/options/createdAt and maps cookies to re-injectable params", () => {
    const session = {
      id: "sess-9",
      options: { headless: false, userAgent: "X" },
      createdAt: 555,
    } as unknown as import("../src/session.js").Session;
    const cookies = [
      { name: "a", value: "1", domain: "d", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" },
    ] as unknown as import("puppeteer-core").Cookie[];

    const persisted = toPersisted(session, cookies);
    expect(persisted.id).toBe("sess-9");
    expect(persisted.createdAt).toBe(555);
    expect(persisted.options).toEqual({ headless: false, userAgent: "X" });
    expect(persisted.cookies[0]).toMatchObject({ name: "a", value: "1", domain: "d", sameSite: "Lax" });
  });

  it("output survives a serialize round-trip", () => {
    const session = {
      id: "s", options: {}, createdAt: 1,
    } as unknown as import("../src/session.js").Session;
    const persisted = toPersisted(session, []);
    const restored = deserializeSessions(serializeSessions([persisted], SAVED_AT));
    expect(restored[0].id).toBe("s");
  });
});

describe("disk I/O: saveToDisk / loadPersisted", () => {
  let dir: string;
  const made: string[] = [];

  function tmpFile(): string {
    dir = mkdtempSync(join(tmpdir(), "anvil-persist-"));
    made.push(dir);
    return join(dir, "nested", "sessions.json");
  }

  afterEach(() => {
    for (const d of made) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    made.length = 0;
  });

  it("round-trips through a real file (creating parent dirs)", () => {
    const path = tmpFile();
    saveToDisk(path, [sample()], SAVED_AT);
    expect(loadPersisted(path)).toEqual([sample()]);
  });

  it("loadPersisted returns [] for a missing file", () => {
    expect(loadPersisted(join(tmpdir(), "anvil-does-not-exist-xyz.json"))).toEqual([]);
  });

  it("loadPersisted returns [] for a garbage file", () => {
    const path = tmpFile();
    saveToDisk(path, [], SAVED_AT); // ensures dir exists
    writeFileSync(path, "{ not valid json");
    expect(loadPersisted(path)).toEqual([]);
  });

  it("saveToDisk then loadPersisted preserves an empty list", () => {
    const path = tmpFile();
    saveToDisk(path, [], SAVED_AT);
    expect(loadPersisted(path)).toEqual([]);
  });
});

describe("restoreSessions", () => {
  it("re-creates each record and injects its cookies", async () => {
    const created: PersistedSession["options"][] = [];
    const setCalls: number[] = [];
    const records = [sample(), { ...sample(), id: "sess-2", cookies: [] }];

    const result = await restoreSessions(
      records,
      async (options) => { created.push(options); return { token: created.length }; },
      async (_session, cookies) => { setCalls.push(cookies.length); },
    );

    expect(result).toEqual({ restored: 2, failed: 0 });
    expect(created).toHaveLength(2);
    // Only the first record has cookies, so setCookies is called once.
    expect(setCalls).toEqual([2]);
  });

  it("isolates per-record failures (the failing create does not abort the rest)", async () => {
    // The 2nd create call throws; the 1st and 3rd should still restore.
    let createCall = 0;
    const records = [sample(), { ...sample(), id: "sess-2" }, { ...sample(), id: "sess-3" }];
    const result = await restoreSessions(
      records,
      async () => {
        createCall++;
        if (createCall === 2) throw new Error("launch failed");
        return {};
      },
      async () => {},
    );
    expect(result).toEqual({ restored: 2, failed: 1 });
  });

  it("returns zero counts for an empty list", async () => {
    const result = await restoreSessions([], async () => ({}), async () => {});
    expect(result).toEqual({ restored: 0, failed: 0 });
  });

  it("a setCookies failure counts the record as failed", async () => {
    const result = await restoreSessions(
      [sample()],
      async () => ({}),
      async () => { throw new Error("inject failed"); },
    );
    expect(result).toEqual({ restored: 0, failed: 1 });
  });
});
