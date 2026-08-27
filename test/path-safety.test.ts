import { describe, it, expect } from "vitest";
import { safeJoin, isSafeFilename, contentDispositionAttachment } from "../src/path-safety.js";

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

  // DEV-0190: real browser downloads have spaces/parens/unicode; the old strict allowlist wrongly 400'd
  // them after /v1/downloads had listed them. These must now be ACCEPTED (traversal/injection still barred).
  it("DEV-0190: accepts real-world download names (spaces, parens, unicode, query-ish chars)", () => {
    for (const f of ["invoice (1).pdf", "report 2024.pdf", "résumé.pdf", "quo?te.txt", "star*.csv", "semi;colon.json"]) {
      expect(isSafeFilename(f), f).toBe(true);
    }
  });

  it("rejects traversal + path separators + drive/colon + header-injection forms", () => {
    for (const f of [
      "../x", "../../etc/passwd", "..\\x", "..\\..\\windows",
      "a/b", "a\\b", "/etc/passwd", "C:\\x", "C:/x",
      "foo:bar",                       // colon: drive / NTFS alternate-data-stream separator
      'quo"te.png',                    // double-quote: Content-Disposition injection
      "line\r\nInjected: header",      // CR/LF: HTTP header injection
      "null\x00byte.png",              // NUL: C-string path truncation
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

describe("contentDispositionAttachment (DEV-0190)", () => {
  it("emits an ASCII fallback + RFC 5987 filename* for a unicode name", () => {
    const cd = contentDispositionAttachment("résumé (1).pdf");
    expect(cd).toMatch(/^attachment; filename="[^"]*"; filename\*=UTF-8''/);
    // non-ASCII replaced in the fallback, real name percent-encoded in filename*
    expect(cd).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20(1).pdf");
    expect(cd).not.toMatch(/filename="[^"]*é/); // no raw unicode in the quoted fallback
  });
  it("a quote/CRLF in the name cannot break out of the header (defense-in-depth)", () => {
    const cd = contentDispositionAttachment('evil".pdf\r\nX-Injected: 1');
    // the quoted fallback has no raw double-quote or CR/LF that could inject a header
    const fallback = cd.slice(cd.indexOf('filename="') + 10, cd.indexOf('"; filename*'));
    expect(fallback).not.toMatch(/["\r\n]/);
  });
});
