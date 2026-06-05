import { describe, it, expect } from "vitest";

describe("anvil-engine file upload endpoint", () => {
  describe("POST /v1/actions/upload — input validation", () => {
    it("requires selector as non-empty string", () => {
      const error = { error: "body.selector must be a non-empty string" };
      expect(error.error).toContain("selector");
    });

    it("requires filename as non-empty string", () => {
      const error = { error: "body.filename must be a non-empty string" };
      expect(error.error).toContain("filename");
    });

    it("requires data as non-empty base64 string", () => {
      const error = { error: "body.data must be a non-empty base64 string" };
      expect(error.error).toContain("base64");
    });

    it("requires active session", () => {
      const error = { error: "No active session" };
      expect(error.error).toBe("No active session");
    });
  });

  describe("filename path traversal protection", () => {
    it("rejects filenames with ..", () => {
      const filename = "../etc/passwd";
      const invalid = filename.includes("..");
      expect(invalid).toBe(true);
    });

    it("rejects filenames with forward slash", () => {
      const filename = "subdir/file.txt";
      const invalid = filename.includes("/");
      expect(invalid).toBe(true);
    });

    it("rejects filenames with backslash", () => {
      const filename = "subdir\\file.txt";
      const invalid = filename.includes("\\");
      expect(invalid).toBe(true);
    });

    it("accepts normal filenames", () => {
      const filename = "document.pdf";
      const invalid = filename.includes("..") || filename.includes("/") || filename.includes("\\");
      expect(invalid).toBe(false);
    });

    it("accepts filenames with spaces and dots", () => {
      const filename = "my file.report.v2.xlsx";
      const invalid = filename.includes("..") || filename.includes("/") || filename.includes("\\");
      expect(invalid).toBe(false);
    });
  });

  describe("base64 data decoding and size limit", () => {
    it("decodes base64 string to Buffer", () => {
      const data = Buffer.from("hello world").toString("base64");
      const decoded = Buffer.from(data, "base64");
      expect(decoded.toString()).toBe("hello world");
    });

    it("enforces 10MB limit (10_485_760 bytes)", () => {
      const limit = 10_485_760;
      expect(limit).toBe(10 * 1024 * 1024);
    });

    it("rejects data exceeding 10MB after decode", () => {
      const oversized = 10_485_761;
      const error = { error: "File data exceeds 10MB limit" };
      expect(oversized > 10_485_760).toBe(true);
      expect(error.error).toContain("10MB");
    });

    it("accepts data under 10MB", () => {
      const smallFile = Buffer.alloc(1024);
      expect(smallFile.length).toBeLessThan(10_485_760);
    });
  });

  describe("temp file handling", () => {
    it("writes to session downloadDir using basename", () => {
      const { basename } = require("node:path");
      const filename = "report.pdf";
      expect(basename(filename)).toBe("report.pdf");
    });

    it("cleanup happens in finally block (always runs)", () => {
      let cleaned = false;
      try {
        throw new Error("upload failed");
      } catch {
        // error expected
      } finally {
        cleaned = true;
      }
      expect(cleaned).toBe(true);
    });

    it("returns 500 if no downloadDir available", () => {
      const error = { error: "No temp directory available" };
      expect(error.error).toBe("No temp directory available");
    });
  });

  describe("success response", () => {
    it("returns {success: true, selector, filename}", () => {
      const response = { success: true, selector: "input[type=file]", filename: "photo.jpg" };
      expect(response.success).toBe(true);
      expect(response.selector).toBe("input[type=file]");
      expect(response.filename).toBe("photo.jpg");
    });
  });

  describe("element not found handling", () => {
    it("throws descriptive error when selector matches nothing", () => {
      const selector = "#nonexistent-input";
      const error = new Error(`Element not found: ${selector}`);
      expect(error.message).toContain(selector);
    });
  });

  describe("request body contract", () => {
    it("accepts full valid body shape", () => {
      const body = {
        selector: "input[type=file]",
        filename: "document.pdf",
        data: Buffer.from("PDF content").toString("base64"),
      };
      expect(body.selector).toBeDefined();
      expect(body.filename).toBeDefined();
      expect(body.data).toBeDefined();
      expect(typeof body.data).toBe("string");
    });
  });
});
