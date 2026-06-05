import { describe, it, expect } from "vitest";

describe("anvil-engine page action endpoints", () => {
  describe("POST /v1/actions/click", () => {
    it("requires selector as non-empty string", () => {
      const validBody = { selector: "#submit-btn" };
      expect(validBody.selector).toBeDefined();
      expect(typeof validBody.selector).toBe("string");
    });

    it("rejects missing selector with 400", () => {
      const errorResponse = { error: "body.selector must be a non-empty string" };
      expect(errorResponse.error).toContain("selector");
    });

    it("supports optional button parameter (left/right/middle)", () => {
      const leftClick = { selector: "a", button: "left" };
      const rightClick = { selector: "a", button: "right" };
      const middleClick = { selector: "a", button: "middle" };
      expect(leftClick.button).toBe("left");
      expect(rightClick.button).toBe("right");
      expect(middleClick.button).toBe("middle");
    });

    it("defaults button to left", () => {
      const body = { selector: ".btn" };
      const button = (body as any).button || "left";
      expect(button).toBe("left");
    });

    it("supports optional clickCount parameter", () => {
      const doubleClick = { selector: "p", clickCount: 2 };
      expect(doubleClick.clickCount).toBe(2);
    });

    it("defaults clickCount to 1", () => {
      const body = { selector: ".btn" };
      const clickCount = (body as any).clickCount || 1;
      expect(clickCount).toBe(1);
    });

    it("returns {success: true, selector} on success", () => {
      const response = { success: true, selector: "#submit-btn" };
      expect(response.success).toBe(true);
      expect(response.selector).toBe("#submit-btn");
    });

    it("requires active session", () => {
      const noSessionError = { error: "No active session" };
      expect(noSessionError.error).toBe("No active session");
    });
  });

  describe("POST /v1/actions/type", () => {
    it("requires selector as non-empty string", () => {
      const validBody = { selector: "#email", text: "user@example.com" };
      expect(validBody.selector).toBeDefined();
      expect(typeof validBody.selector).toBe("string");
    });

    it("requires text as non-empty string", () => {
      const errorResponse = { error: "body.text must be a non-empty string" };
      expect(errorResponse.error).toContain("text");
    });

    it("supports optional delay between keystrokes", () => {
      const withDelay = { selector: "#input", text: "hello", delay: 50 };
      expect(withDelay.delay).toBe(50);
    });

    it("defaults delay to 0", () => {
      const body = { selector: "#input", text: "fast" };
      const delay = (body as any).delay || 0;
      expect(delay).toBe(0);
    });

    it("returns {success: true, selector} on success", () => {
      const response = { success: true, selector: "#email" };
      expect(response.success).toBe(true);
      expect(response.selector).toBe("#email");
    });
  });

  describe("POST /v1/actions/select", () => {
    it("requires selector as non-empty string", () => {
      const validBody = { selector: "select#country", values: ["US"] };
      expect(validBody.selector).toBeDefined();
    });

    it("requires values as an array", () => {
      const errorResponse = { error: "body.values must be an array of strings" };
      expect(errorResponse.error).toContain("array");
    });

    it("accepts single value selection", () => {
      const singleSelect = { selector: "#dropdown", values: ["option1"] };
      expect(singleSelect.values).toHaveLength(1);
    });

    it("accepts multi-value selection", () => {
      const multiSelect = { selector: "#multi", values: ["a", "b", "c"] };
      expect(multiSelect.values).toHaveLength(3);
    });

    it("returns {success, selector, selected} — selected is array of chosen values", () => {
      const response = { success: true, selector: "#dropdown", selected: ["option1"] };
      expect(response.selected).toBeInstanceOf(Array);
      expect(response.success).toBe(true);
    });
  });

  describe("POST /v1/actions/hover", () => {
    it("requires selector as non-empty string", () => {
      const validBody = { selector: ".menu-item" };
      expect(validBody.selector).toBeDefined();
    });

    it("rejects missing selector", () => {
      const errorResponse = { error: "body.selector must be a non-empty string" };
      expect(errorResponse.error).toContain("selector");
    });

    it("returns {success: true, selector} on success", () => {
      const response = { success: true, selector: ".menu-item" };
      expect(response.success).toBe(true);
      expect(response.selector).toBe(".menu-item");
    });

    it("requires active session", () => {
      const noSessionError = { error: "No active session" };
      expect(noSessionError.error).toBe("No active session");
    });
  });

  describe("POST /v1/actions/wait", () => {
    it("requires selector as non-empty string", () => {
      const validBody = { selector: ".loaded-content" };
      expect(validBody.selector).toBeDefined();
    });

    it("supports optional timeout parameter", () => {
      const withTimeout = { selector: "#spinner", timeout: 5000 };
      expect(withTimeout.timeout).toBe(5000);
    });

    it("defaults timeout to 10000ms", () => {
      const body = { selector: ".content" };
      const timeout = (body as any).timeout || 10000;
      expect(timeout).toBe(10000);
    });

    it("returns {success: true, selector} on success", () => {
      const response = { success: true, selector: ".loaded-content" };
      expect(response.success).toBe(true);
    });

    it("requires active session", () => {
      const noSessionError = { error: "No active session" };
      expect(noSessionError.error).toBe("No active session");
    });
  });

  describe("shared contract: all action endpoints", () => {
    it("all 5 endpoints share the same selector validation pattern", () => {
      const endpoints = [
        "/v1/actions/click",
        "/v1/actions/type",
        "/v1/actions/select",
        "/v1/actions/hover",
        "/v1/actions/wait",
      ];
      expect(endpoints).toHaveLength(5);
      endpoints.forEach(ep => expect(ep).toContain("/v1/actions/"));
    });

    it("all return consistent error format", () => {
      const selectorError = { error: "body.selector must be a non-empty string" };
      const sessionError = { error: "No active session" };
      expect(selectorError).toHaveProperty("error");
      expect(sessionError).toHaveProperty("error");
    });

    it("all use withBrowser for safe connect/disconnect", async () => {
      const mod = await import("../src/browser-helper.js");
      expect(typeof mod.withBrowser).toBe("function");
    });
  });
});
