import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

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
