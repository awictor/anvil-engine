import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// DEV-0122: DataFaucet's OWNER-ACTION.md step 4 tells the owner to `git clone anvil-engine &&
// docker compose up` before flipping BROWSER_BACKEND=anvil. That command needs a docker-compose.yml
// (the repo previously had only a Dockerfile). Guard the compose file's shape so it can't silently
// rot away from the Dockerfile it wraps — no js-yaml dep, structural assertions on the text.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");

describe("docker-compose.yml (DEV-0122 — one-command self-host)", () => {
  it("defines an anvil service built from the local Dockerfile", () => {
    expect(compose).toMatch(/^\s{2}anvil:/m);
    expect(compose).toMatch(/build:\s*\./);
  });

  it("publishes port 3000 (matches the Dockerfile EXPOSE + app default)", () => {
    expect(compose).toMatch(/"3000:3000"/);
  });

  it("forwards the ANVIL_ env knobs used by config.ts", () => {
    for (const key of ["ANVIL_ENGINE_PORT", "ANVIL_HOST", "ANVIL_API_KEY", "ANVIL_MAX_SESSIONS"]) {
      expect(compose, `compose missing ${key}`).toContain(key);
    }
  });

  it("the port and bind match the Dockerfile's defaults (drift guard vs the image)", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    // Dockerfile EXPOSE 3000 + ANVIL_ENGINE_PORT=3000 — the compose publish must line up.
    expect(dockerfile).toMatch(/EXPOSE\s+3000/);
    expect(dockerfile).toMatch(/ANVIL_ENGINE_PORT=3000/);
  });
});
