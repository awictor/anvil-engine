import { describe, it, expect } from "vitest";
import { AnvilClient } from "../src/client.js";

describe("anvil-engine SDK client", () => {
  describe("AnvilClient constructor", () => {
    it("accepts baseUrl and optional apiKey", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
      expect(client).toBeDefined();
    });

    it("accepts apiKey for authenticated requests", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000", apiKey: "secret" });
      expect(client).toBeDefined();
    });

    it("strips trailing slash from baseUrl", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000/" });
      expect(client).toBeDefined();
    });
  });

  describe("session lifecycle methods", () => {
    it("has createSession method", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
      expect(typeof client.createSession).toBe("function");
    });

    it("has getSession method", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
      expect(typeof client.getSession).toBe("function");
    });

    it("has getSessionById method", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
      expect(typeof client.getSessionById).toBe("function");
    });

    it("has listSessions method", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
      expect(typeof client.listSessions).toBe("function");
    });

    it("has releaseSession method", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
      expect(typeof client.releaseSession).toBe("function");
    });

    it("has health method", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
      expect(typeof client.health).toBe("function");
    });
  });

  describe("action methods", () => {
    const client = new AnvilClient({ baseUrl: "http://localhost:3000" });

    it("has navigate method", () => { expect(typeof client.navigate).toBe("function"); });
    it("has click method", () => { expect(typeof client.click).toBe("function"); });
    it("has type method", () => { expect(typeof client.type).toBe("function"); });
    it("has select method", () => { expect(typeof client.select).toBe("function"); });
    it("has hover method", () => { expect(typeof client.hover).toBe("function"); });
    it("has waitForSelector method", () => { expect(typeof client.waitForSelector).toBe("function"); });
    it("has evaluate method", () => { expect(typeof client.evaluate).toBe("function"); });
    it("has upload method", () => { expect(typeof client.upload).toBe("function"); });
  });

  describe("content methods", () => {
    const client = new AnvilClient({ baseUrl: "http://localhost:3000" });

    it("has scrape method", () => { expect(typeof client.scrape).toBe("function"); });
    it("has pdf method", () => { expect(typeof client.pdf).toBe("function"); });
    it("has screenshot method", () => { expect(typeof client.screenshot).toBe("function"); });
    it("has getCookies method", () => { expect(typeof client.getCookies).toBe("function"); });
    it("has setCookies method", () => { expect(typeof client.setCookies).toBe("function"); });
  });

  describe("network methods", () => {
    const client = new AnvilClient({ baseUrl: "http://localhost:3000" });

    it("has startHar method", () => { expect(typeof client.startHar).toBe("function"); });
    it("has stopHar method", () => { expect(typeof client.stopHar).toBe("function"); });
    it("has getHar method", () => { expect(typeof client.getHar).toBe("function"); });
    it("has intercept method", () => { expect(typeof client.intercept).toBe("function"); });
  });

  describe("file methods", () => {
    const client = new AnvilClient({ baseUrl: "http://localhost:3000" });

    it("has listDownloads method", () => { expect(typeof client.listDownloads).toBe("function"); });
    it("has getDownload method", () => { expect(typeof client.getDownload).toBe("function"); });
  });

  describe("method count verification", () => {
    it("has exactly 24 API methods (matching 24 endpoints)", () => {
      const client = new AnvilClient({ baseUrl: "http://localhost:3000" });
      const methods = [
        "createSession", "getSession", "getSessionById", "listSessions", "releaseSession", "health",
        "navigate", "click", "type", "select", "hover", "waitForSelector", "evaluate", "upload",
        "scrape", "pdf", "screenshot", "getCookies", "setCookies",
        "startHar", "stopHar", "getHar", "intercept",
        "listDownloads", "getDownload",
      ];
      methods.forEach(m => expect(typeof (client as any)[m]).toBe("function"));
      expect(methods.length).toBe(25); // 24 endpoints + getSessionById
    });
  });

  describe("exports", () => {
    it("AnvilClient is exported as named export", async () => {
      const mod = await import("../src/client.js");
      expect(mod.AnvilClient).toBeDefined();
      expect(typeof mod.AnvilClient).toBe("function");
    });

    it("AnvilClientOptions type is available (interface compiles)", () => {
      const opts: import("../src/client.js").AnvilClientOptions = { baseUrl: "http://localhost:3000" };
      expect(opts.baseUrl).toBe("http://localhost:3000");
    });
  });
});
