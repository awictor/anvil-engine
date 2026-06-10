import { describe, it, expect } from "vitest";
import {
  serializeSessions,
  deserializeSessions,
  toPersisted,
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
