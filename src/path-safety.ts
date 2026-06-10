import { resolve, sep } from "node:path";

const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates a user-supplied filename against a strict allowlist and confirms
 * the resolved path stays inside `dir`. Returns the resolved absolute path,
 * or null when the name is unsafe. The allowlist (no slashes, backslashes,
 * or colons) closes the basename() platform-divergence bypass where
 * "..\\..\\x" passes a forward-slash check on Linux.
 */
export function safeJoin(dir: string, filename: string): string | null {
  if (!filename || !SAFE_FILENAME.test(filename)) return null;
  if (filename === "." || filename === "..") return null;

  const base = resolve(dir);
  const full = resolve(base, filename);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export function isSafeFilename(filename: string): boolean {
  return SAFE_FILENAME.test(filename) && filename !== "." && filename !== "..";
}
