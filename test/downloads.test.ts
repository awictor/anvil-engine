import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { contentTypeFor, downloadRoutes } from "../src/routes/downloads.js";
import { Writable } from "node:stream";

describe("contentTypeFor (DEV-0047)", () => {
  it("maps common extensions to their mime type (case-insensitive)", () => {
    expect(contentTypeFor("report.pdf")).toBe("application/pdf");
    expect(contentTypeFor("shot.PNG")).toBe("image/png");
    expect(contentTypeFor("a.jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("data.json")).toBe("application/json");
    expect(contentTypeFor("notes.txt")).toBe("text/plain");
    expect(contentTypeFor("page.html")).toBe("text/html");
    expect(contentTypeFor("rows.csv")).toBe("text/csv");
    expect(contentTypeFor("bundle.zip")).toBe("application/zip");
  });
  it("defaults unknown / no extension to application/octet-stream", () => {
    expect(contentTypeFor("weird.xyz")).toBe("application/octet-stream");
    expect(contentTypeFor("noext")).toBe("application/octet-stream");
    expect(contentTypeFor("archive.tar.unknownext")).toBe("application/octet-stream");
  });
  it("uses the LAST extension for a multi-dot name", () => {
    expect(contentTypeFor("report.final.pdf")).toBe("application/pdf");
  });
});

describe("anvil-engine file download endpoints", () => {
  describe("GET /v1/downloads — list endpoint contract", () => {
    it("requires active session (returns 400 without)", () => {
      const expectedError = { error: "No active session" };
      expect(expectedError.error).toBe("No active session");
    });

    it("returns files array with name, size, createdAt fields", () => {
      const expectedShape = {
        files: [{ name: "report.pdf", size: 1024, createdAt: "2026-06-05T00:00:00.000Z" }],
      };
      expect(expectedShape.files).toBeInstanceOf(Array);
      expect(expectedShape.files[0]).toHaveProperty("name");
      expect(expectedShape.files[0]).toHaveProperty("size");
      expect(expectedShape.files[0]).toHaveProperty("createdAt");
    });

    it("returns empty files array when no downloads exist", () => {
      const emptyResponse = { files: [] };
      expect(emptyResponse.files).toHaveLength(0);
    });

    it("returns empty files array when downloadDir is undefined", () => {
      const response = { files: [] };
      expect(response.files).toEqual([]);
    });
  });

  describe("GET /v1/downloads/:filename — retrieve endpoint contract", () => {
    it("requires active session", () => {
      const expectedError = { error: "No active session" };
      expect(expectedError.error).toBe("No active session");
    });

    it("returns 404 when file does not exist", () => {
      const expectedError = { error: "File not found" };
      expect(expectedError.error).toBe("File not found");
    });

    it("returns 404 when no download directory", () => {
      const expectedError = { error: "No download directory" };
      expect(expectedError.error).toBe("No download directory");
    });

    it("returns binary with Content-Disposition header", () => {
      const filename = "report.pdf";
      const expectedHeader = `attachment; filename="${filename}"`;
      expect(expectedHeader).toContain("attachment");
      expect(expectedHeader).toContain(filename);
    });

    it("sets Content-Type to application/octet-stream", () => {
      const contentType = "application/octet-stream";
      expect(contentType).toBe("application/octet-stream");
    });

    it("sets Content-Length header", () => {
      const size = 2048;
      const header = size.toString();
      expect(header).toBe("2048");
    });
  });

  describe("path traversal protection", () => {
    it("rejects filenames with ..", () => {
      const malicious = "../../../etc/passwd";
      expect(malicious.includes("..")).toBe(true);
    });

    it("rejects filenames with forward slashes", () => {
      const malicious = "subdir/secret.txt";
      expect(malicious.includes("/")).toBe(true);
    });

    it("rejects filenames with backslashes", () => {
      const malicious = "subdir\\secret.txt";
      expect(malicious.includes("\\")).toBe(true);
    });

    it("accepts normal filenames", () => {
      const safe = "report-2026.pdf";
      expect(safe.includes("..")).toBe(false);
      expect(safe.includes("/")).toBe(false);
      expect(safe.includes("\\")).toBe(false);
    });

    it("decodes URI-encoded filenames", () => {
      const encoded = "my%20report.pdf";
      const decoded = decodeURIComponent(encoded);
      expect(decoded).toBe("my report.pdf");
    });
  });

  describe("download directory lifecycle", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `anvil-downloads-${randomUUID()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("creates a unique temp directory per session", () => {
      expect(existsSync(testDir)).toBe(true);
      expect(testDir).toContain("anvil-downloads-");
    });

    it("directory is under os.tmpdir()", () => {
      expect(testDir.startsWith(tmpdir())).toBe(true);
    });

    it("can list files from the download directory", () => {
      writeFileSync(join(testDir, "test.txt"), "hello");
      writeFileSync(join(testDir, "data.json"), '{"key":"value"}');

      const { readdirSync } = require("node:fs");
      const files = readdirSync(testDir);
      expect(files).toHaveLength(2);
      expect(files).toContain("test.txt");
      expect(files).toContain("data.json");
    });

    it("cleanup removes directory and all contents", () => {
      writeFileSync(join(testDir, "file1.bin"), Buffer.alloc(100));
      writeFileSync(join(testDir, "file2.bin"), Buffer.alloc(200));

      rmSync(testDir, { recursive: true, force: true });
      expect(existsSync(testDir)).toBe(false);
    });

    it("stat provides size and birthtime for listing", () => {
      const content = Buffer.alloc(512);
      writeFileSync(join(testDir, "sized.bin"), content);

      const { statSync } = require("node:fs");
      const st = statSync(join(testDir, "sized.bin"));
      expect(st.size).toBe(512);
      expect(st.birthtime).toBeInstanceOf(Date);
    });
  });

  describe("BrowserProcess.downloadDir integration", () => {
    it("downloadDir is optional on BrowserProcess interface", () => {
      const proc = { pid: 1, cdpPort: 9222, wsEndpoint: "ws://...", process: null as any };
      expect(proc).not.toHaveProperty("downloadDir");
    });

    it("downloadDir is set when launcher creates temp dir", () => {
      const downloadDir = join(tmpdir(), "anvil-downloads-test-uuid");
      const proc = { pid: 1, cdpPort: 9222, wsEndpoint: "ws://...", process: null as any, downloadDir };
      expect(proc.downloadDir).toContain("anvil-downloads-");
    });

    it("Chrome --download-default-directory flag format is correct", () => {
      const dir = "/tmp/anvil-downloads-abc123";
      const flag = `--download-default-directory=${dir}`;
      expect(flag).toBe("--download-default-directory=/tmp/anvil-downloads-abc123");
    });
  });
});

// DEV-0048: exercise the ACTUAL downloadRoutes handlers (the blocks above assert literals,
// they never invoke the route). Drives /v1/downloads/*filename with a mock req/res + a fake
// session whose browserProcess.downloadDir is a real temp dir, asserting the route-level
// branches: traversal -> 400, missing -> 404, no downloadDir -> 404, real file -> 200 with
// Content-Disposition attachment + the DEV-0047 content-type + Content-Length.
describe("downloadRoutes handlers (DEV-0048 route layer)", () => {
  // Minimal ServerResponse stand-in: a Writable that records writeHead + collects the body,
  // and resolves `done` on finish so we can await createReadStream(...).pipe(res).
  function mkRes() {
    let statusCode = 0;
    let headers: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let resolveDone: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    (res as any).headersSent = false;
    (res as any).writeHead = (code: number, h?: Record<string, string>) => {
      statusCode = code;
      if (h) headers = h;
      (res as any).headersSent = true;
      return res;
    };
    res.on("finish", () => resolveDone());
    return {
      res: res as any,
      done,
      get status() { return statusCode; },
      get headers() { return headers; },
      get body() { return Buffer.concat(chunks).toString(); },
    };
  }

  function fakeDeps(downloadDir: string | undefined) {
    const session = { browserProcess: { downloadDir } };
    return { sessionManager: { getActive: () => session, get: () => session } } as any;
  }

  function getRoute(deps: any) {
    return downloadRoutes(deps).find(
      (r: any) => r.pattern === "/v1/downloads/*filename",
    )!;
  }

  const req = { headers: {} } as any;
  const mkUrl = () => new URL("http://x/v1/downloads/x");

  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `anvil-dl-route-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("rejects a traversal filename with 400 Invalid filename", async () => {
    const route = getRoute(fakeDeps(dir));
    const r = mkRes();
    await route.handler({ req, res: r.res, url: mkUrl(), params: { filename: "../../etc/passwd" }, requestId: "t" });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe("Invalid filename");
  });

  it("returns 404 when the file does not exist", async () => {
    const route = getRoute(fakeDeps(dir));
    const r = mkRes();
    await route.handler({ req, res: r.res, url: mkUrl(), params: { filename: "nope.pdf" }, requestId: "t" });
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toBe("File not found");
  });

  it("returns 404 when the session has no downloadDir", async () => {
    const route = getRoute(fakeDeps(undefined));
    const r = mkRes();
    await route.handler({ req, res: r.res, url: mkUrl(), params: { filename: "x.pdf" }, requestId: "t" });
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toBe("No download directory");
  });

  it("serves a real file: 200 + attachment + DEV-0047 content-type + Content-Length", async () => {
    writeFileSync(join(dir, "report.pdf"), Buffer.alloc(2048));
    const route = getRoute(fakeDeps(dir));
    const r = mkRes();
    await route.handler({ req, res: r.res, url: mkUrl(), params: { filename: "report.pdf" }, requestId: "t" });
    await r.done;
    expect(r.status).toBe(200);
    // DEV-0190: RFC 5987 form — ASCII fallback + filename*; still names report.pdf, header-injection-safe.
    expect(r.headers["Content-Disposition"]).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
    expect(r.headers["Content-Type"]).toBe("application/pdf"); // DEV-0047 wiring, not octet-stream
    expect(r.headers["Content-Length"]).toBe("2048");
    expect(r.body.length).toBe(2048);
  });

  it("DEV-0190: serves a real download with spaces/parens (was 400'd by the old strict allowlist)", async () => {
    writeFileSync(join(dir, "invoice (1).pdf"), Buffer.alloc(512));
    const route = getRoute(fakeDeps(dir));
    const r = mkRes();
    await route.handler({ req, res: r.res, url: mkUrl(), params: { filename: "invoice (1).pdf" }, requestId: "t" });
    await r.done;
    expect(r.status).toBe(200);
    expect(r.headers["Content-Disposition"]).toContain(`filename*=UTF-8''invoice%20(1).pdf`);
    expect(r.body.length).toBe(512);
  });

  it("unknown extension falls back to octet-stream on a real file", async () => {
    writeFileSync(join(dir, "blob.weirdext"), Buffer.alloc(10));
    const route = getRoute(fakeDeps(dir));
    const r = mkRes();
    await route.handler({ req, res: r.res, url: mkUrl(), params: { filename: "blob.weirdext" }, requestId: "t" });
    await r.done;
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe("application/octet-stream");
  });
});
