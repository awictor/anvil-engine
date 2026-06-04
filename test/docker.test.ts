import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

describe("Dockerfile", () => {
  it("exists at project root", () => {
    expect(existsSync(resolve(ROOT, "Dockerfile"))).toBe(true);
  });

  it("uses node:22-slim base image", () => {
    const content = readFileSync(resolve(ROOT, "Dockerfile"), "utf-8");
    expect(content).toContain("FROM node:22-slim");
  });

  it("installs chromium from apt", () => {
    const content = readFileSync(resolve(ROOT, "Dockerfile"), "utf-8");
    expect(content).toContain("chromium");
    expect(content).toContain("apt-get install");
  });

  it("sets CHROME_PATH environment variable", () => {
    const content = readFileSync(resolve(ROOT, "Dockerfile"), "utf-8");
    expect(content).toContain("ENV CHROME_PATH=/usr/bin/chromium");
  });

  it("exposes port 3000", () => {
    const content = readFileSync(resolve(ROOT, "Dockerfile"), "utf-8");
    expect(content).toContain("EXPOSE 3000");
  });

  it("runs dist/api.js as entrypoint", () => {
    const content = readFileSync(resolve(ROOT, "Dockerfile"), "utf-8");
    expect(content).toContain("dist/api.js");
  });
});

describe(".dockerignore", () => {
  it("exists at project root", () => {
    expect(existsSync(resolve(ROOT, ".dockerignore"))).toBe(true);
  });

  it("excludes node_modules and src", () => {
    const content = readFileSync(resolve(ROOT, ".dockerignore"), "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain("src");
  });
});

describe("build prerequisites", () => {
  it("dist/ directory exists after build", () => {
    expect(existsSync(resolve(ROOT, "dist"))).toBe(true);
  });

  it("dist/api.js exists (Docker CMD target)", () => {
    expect(existsSync(resolve(ROOT, "dist", "api.js"))).toBe(true);
  });
});
