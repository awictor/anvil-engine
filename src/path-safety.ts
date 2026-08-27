import { resolve, sep } from "node:path";

// DEV-0190: real browser downloads carry spaces/parens/unicode ("invoice (1).pdf", "résumé.pdf"), so a
// strict [a-zA-Z0-9._-] allowlist wrongly 400'd files /v1/downloads had just LISTED. Switch to a
// denylist of the only chars that are actually dangerous, and keep the resolve()-containment check
// below as the traversal backstop:
//   - path separators  / \  (directory escape; the resolve() check is the second line of defense)
//   - control chars \x00-\x1f  — includes CR/LF, which would let a filename inject HTTP headers when
//     it is interpolated into Content-Disposition (downloads.ts). NUL also truncates paths in C land.
//   - double-quote "  — closes/breaks the quoted Content-Disposition filename param (header injection).
//   - colon :  — Windows drive prefix (C:) + NTFS alternate-data-stream separator ("file.txt:evil").
// Everything else (spaces, parens, brackets, unicode letters, +,=,@,?,*,;, etc.) is a legitimate
// filename — a query-ish char in a saved name is harmless once path-separators/quotes/colon are gone.
const UNSAFE_FILENAME = /[/\\:\x00-\x1f"]/;

/**
 * Validates a user-supplied filename (denylist of separators/control-chars/quote) and confirms the
 * resolved path stays inside `dir`. Returns the resolved absolute path, or null when the name is
 * unsafe. The resolve()-startsWith check closes the basename() platform-divergence bypass where
 * "..\\..\\x" would slip a forward-slash-only check on Linux; the denylist blocks header-injection.
 */
export function safeJoin(dir: string, filename: string): string | null {
  if (!isSafeFilename(filename)) return null;

  const base = resolve(dir);
  const full = resolve(base, filename);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export function isSafeFilename(filename: string): boolean {
  if (!filename || filename === "." || filename === "..") return false;
  if (UNSAFE_FILENAME.test(filename)) return false;
  // A leading ".." segment or any embedded parent ref is caught by the resolve() containment in
  // safeJoin, but reject the bare/prefixed forms early so isSafeFilename alone is trustworthy.
  if (filename.startsWith("..")) return false;
  return true;
}

/**
 * RFC 5987 / RFC 6266 Content-Disposition value for a possibly-non-ASCII filename (DEV-0190). Emits
 * BOTH a sanitized ASCII `filename=` fallback (quotes + control chars + backslash stripped, never
 * unescaped into the header) and a `filename*=UTF-8''<pct-encoded>` so modern clients get the real
 * name and old ones still get a safe one. Callers must use this instead of interpolating the raw name.
 */
export function contentDispositionAttachment(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
