import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for auth secrets (DEV-0191). A plain `a === b` / `a !== b` on a
 * token leaks how many leading chars matched via timing, letting an attacker refine a guess. Compare
 * as bytes with crypto.timingSafeEqual, which requires equal-length buffers — so length-guard first.
 *
 * The early length check is itself a (tiny) side-channel on the SECRET's length, which is not
 * meaningful to protect: knowing the key length doesn't shrink the keyspace enough to matter, and
 * timingSafeEqual mandates equal lengths. Returns false for any empty/absent input.
 */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
