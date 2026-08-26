import { describe, it, expect } from "vitest";
import { safeJoin, isSafeFilename } from "../src/path-safety.js";

// DEV-0026: path-safety is the download path-traversal guard on GET /v1/downloads/:filename.
// It had zero direct tests. Pin the allowlist + containment so a refactor can't reopen traversal.
// The allowlist (SAFE_FILENAME = [A-Za-z0-9._-]+) rejects slashes/backslashes/colons, which closes
// the basename() platform-divergence bypass ("..\\x" passing a forward-slash check on Linux).

describe("isSafeFilename (DEV-0026)", () => {
  it("accepts plain filenames", () => {
    for (const f of ["report.pdf", "a", "file_1-2.3.txt", "IMG.PNG"]) {
      expect(isSafeFilename(f), f).toBe(true);
    }
  });

  it("rejects traversal + path separators + drive/colon forms", () => {
    for (const f of [
      "../x", "../../etc/passwd", "..\\x", "..\\..\\windows",
      "a/b", "a\\b", "/etc/passwd", "C:\\x", "C:/x",
      "foo:bar", "with space", "quo?te", "star*", "semi;colon",
    ]) {
      expect(isSafeFilename(f), f).toBe(false);
    }
  });

  it("rejects the bare . and .. names and empty", () => {
    expect(isSafeFilename(".")).toBe(false);
    expect(isSafeFilename("..")).toBe(false);
    expect(isSafeFilename("")).toBe(false);
  });
});

describe("safeJoin (DEV-0026)", () => {
  const dir = "/srv/downloads";

  it("returns an in-dir absolute path for a safe name", () => {
    const out = safeJoin(dir, "report.pdf");
    expect(out).not.toBeNull();
    // resolved under dir, ends with the filename
    expect(out!.replace(/\\/g, "/")).toMatch(/\/srv\/downloads\/report\.pdf$/);
  });

  it("returns null for every unsafe name (no path escapes dir)", () => {
    for (const f of ["../secret", "..\\secret", "/etc/passwd", "C:\\x", "a/b", ".", "..", "", "x/../../y"]) {
      expect(safeJoin(dir, f), f).toBeNull();
    }
  });

  it("an empty filename is null (no dir-as-file)", () => {
    expect(safeJoin(dir, "")).toBeNull();
  });
});
