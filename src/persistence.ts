import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Session } from "./session.js";
import { type LaunchOptions } from "./launcher.js";
import type { Cookie, CookieParam } from "puppeteer-core";

/**
 * Pure (de)serialization for session persistence across engine restarts. These
 * functions never touch disk or the browser — they convert between live session
 * data and a versioned JSON envelope. Wiring into shutdown/startup lives
 * elsewhere; keeping this layer pure makes it trivially testable and reusable.
 */

const PERSIST_VERSION = 1;

export interface PersistedSession {
  id: string;
  options: LaunchOptions;
  createdAt: number;
  cookies: CookieParam[];
}

interface PersistEnvelope {
  version: number;
  savedAt: number;
  sessions: PersistedSession[];
}

/** Builds a persistable record from a live session and its current cookies. */
export function toPersisted(session: Session, cookies: Cookie[]): PersistedSession {
  return {
    id: session.id,
    options: session.options,
    createdAt: session.createdAt,
    // Cookie is a superset of CookieParam; keep the fields needed to re-inject.
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    })),
  };
}

/** Serializes persisted sessions into a versioned JSON envelope. `savedAt` is caller-supplied (ms epoch) to keep this pure. */
export function serializeSessions(sessions: PersistedSession[], savedAt: number): string {
  const envelope: PersistEnvelope = { version: PERSIST_VERSION, savedAt, sessions };
  return JSON.stringify(envelope);
}

/**
 * Parses a persisted envelope back into sessions. Tolerant by design: any
 * malformed JSON, wrong/missing version, or non-conforming shape yields [] so a
 * corrupt persistence file can never crash startup.
 */
export function deserializeSessions(json: string): PersistedSession[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const envelope = parsed as Partial<PersistEnvelope>;
  if (envelope.version !== PERSIST_VERSION || !Array.isArray(envelope.sessions)) return [];

  const out: PersistedSession[] = [];
  for (const entry of envelope.sessions) {
    if (!entry || typeof entry !== "object") continue;
    const s = entry as Partial<PersistedSession>;
    if (typeof s.id !== "string" || typeof s.createdAt !== "number") continue;
    out.push({
      id: s.id,
      options: (s.options && typeof s.options === "object" ? s.options : {}) as LaunchOptions,
      createdAt: s.createdAt,
      cookies: Array.isArray(s.cookies) ? (s.cookies as CookieParam[]) : [],
    });
  }
  return out;
}

/**
 * Reads persisted sessions from disk. Missing or unreadable file → []. Combined
 * with deserializeSessions' tolerance, a corrupt or absent persistence file
 * always degrades to "start fresh" rather than throwing.
 */
export function loadPersisted(path: string): PersistedSession[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return deserializeSessions(raw);
}

/** Writes persisted sessions to disk, creating parent dirs as needed. */
export function saveToDisk(path: string, sessions: PersistedSession[], savedAt: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeSessions(sessions, savedAt));
}
