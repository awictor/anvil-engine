import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { removeDownloadDir } from "../src/launcher.js";

// Reclamation of per-session download directories. This is the leak the
// disk-pressure issue pointed at: relaunch used to orphan the fresh browser's
// dir. removeDownloadDir is the shared cleanup used by destroy + relaunch.

describe("removeDownloadDir", () => {
  const made: string[] = [];

  afterEach(() => {
    for (const d of made) {
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
    made.length = 0;
  });

  function tempDownloadDir(withFile = true): string {
    const dir = mkdtempSync(join(tmpdir(), "anvil-dl-test-"));
    made.push(dir);
    if (withFile) writeFileSync(join(dir, "download.bin"), "data");
    return dir;
  }

  it("removes the directory and its contents", () => {
    const dir = tempDownloadDir();
    expect(existsSync(dir)).toBe(true);
    removeDownloadDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("is a no-op for undefined (sessions without a download dir)", () => {
    expect(() => removeDownloadDir(undefined)).not.toThrow();
  });

  it("is idempotent — removing an already-gone dir does not throw", () => {
    const dir = tempDownloadDir(false);
    removeDownloadDir(dir);
    expect(existsSync(dir)).toBe(false);
    expect(() => removeDownloadDir(dir)).not.toThrow();
  });

  it("removes nested content (subdirs + files)", () => {
    const dir = tempDownloadDir(false);
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "f.txt"), "x");
    removeDownloadDir(dir);
    expect(existsSync(dir)).toBe(false);
  });
});
