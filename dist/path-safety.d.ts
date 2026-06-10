/**
 * Validates a user-supplied filename against a strict allowlist and confirms
 * the resolved path stays inside `dir`. Returns the resolved absolute path,
 * or null when the name is unsafe. The allowlist (no slashes, backslashes,
 * or colons) closes the basename() platform-divergence bypass where
 * "..\\..\\x" passes a forward-slash check on Linux.
 */
export declare function safeJoin(dir: string, filename: string): string | null;
export declare function isSafeFilename(filename: string): boolean;
