import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// DEV-0057: keep the README Configuration table in sync with the env vars the code reads. anvil is
// load-bearing infra; a new ANVIL_ toggle (especially a security one — DEV-0056 found two undocumented
// security switches) must not ship invisible to operators. Scans src for process.env.ANVIL_* and
// asserts each name is mentioned in README.md.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function anvilEnvVarsReadInSrc(): Set<string> {
  const re = /process\.env\.(ANVIL_[A-Z0-9_]+)/g;
  const found = new Set<string>();
  for (const f of walk(SRC)) {
    const text = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) found.add(m[1]!);
  }
  return found;
}

describe("README env-var parity (DEV-0057)", () => {
  it("documents every ANVIL_ env var the code reads", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const read = [...anvilEnvVarsReadInSrc()].sort();
    const missing = read.filter((k) => !readme.includes(k));
    expect(missing, `ANVIL_ env vars read in src but absent from README: ${missing.join(", ")}`).toEqual([]);
  });

  it("finds the known security toggles (guards the scanner itself)", () => {
    const read = anvilEnvVarsReadInSrc();
    for (const k of ["ANVIL_API_KEY", "ANVIL_REQUIRE_CDP_AUTH", "ANVIL_ALLOW_PRIVATE_PROXY"]) {
      expect(read.has(k), `scanner should have found ${k}`).toBe(true);
    }
  });
});
