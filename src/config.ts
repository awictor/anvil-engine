export interface Config {
  port: number;
  host: string;
  apiKey: string;
  sessionTimeoutMs: number;
  rateLimitRpm: number;
  maxSessions: number;
  poolSize: number;
  webhookUrl: string;
  evaluateTimeoutMs: number;
  harMaxEntries: number;
  persistPath: string;
}

export class ConfigError extends Error {
  constructor(public problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

interface NumericSpec {
  env: string;
  fallback: number;
  min?: number;
  max?: number;
}

// Deliberately `Number(raw) || fallback` (not ??): "0" yields the fallback,
// matching long-standing behavior that session-timeout tests pin.
function numeric(env: NodeJS.ProcessEnv, spec: NumericSpec, problems: string[]): number {
  const raw = env[spec.env];
  if (raw !== undefined && raw !== "" && Number.isNaN(Number(raw))) {
    problems.push(`${spec.env}="${raw}" is not a number`);
    return spec.fallback;
  }
  const value = Number(raw) || spec.fallback;
  if (spec.min !== undefined && value < spec.min) {
    problems.push(`${spec.env}=${value} is below minimum ${spec.min}`);
  }
  if (spec.max !== undefined && value > spec.max) {
    problems.push(`${spec.env}=${value} is above maximum ${spec.max}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const port = numeric(env, { env: "ANVIL_ENGINE_PORT", fallback: 3000, min: 1, max: 65535 }, problems);
  const sessionTimeoutMs = numeric(env, { env: "ANVIL_SESSION_TIMEOUT_MS", fallback: 300000, min: 0 }, problems);
  const rateLimitRpm = numeric(env, { env: "ANVIL_RATE_LIMIT_RPM", fallback: 0, min: 0 }, problems);
  const maxSessions = numeric(env, { env: "ANVIL_MAX_SESSIONS", fallback: 10, min: 1 }, problems);
  const poolSize = numeric(env, { env: "ANVIL_POOL_SIZE", fallback: 0, min: 0 }, problems);
  const evaluateTimeoutMs = numeric(env, { env: "ANVIL_EVALUATE_TIMEOUT_MS", fallback: 30000, min: 100, max: 60000 }, problems);
  const harMaxEntries = numeric(env, { env: "ANVIL_HAR_MAX_ENTRIES", fallback: 5000, min: 1 }, problems);

  const webhookUrl = env.ANVIL_WEBHOOK_URL || "";
  if (webhookUrl) {
    try {
      const parsed = new URL(webhookUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        problems.push(`ANVIL_WEBHOOK_URL must be http(s), got ${parsed.protocol}`);
      }
    } catch {
      problems.push(`ANVIL_WEBHOOK_URL="${webhookUrl}" is not a valid URL`);
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    port,
    host: env.ANVIL_HOST || "0.0.0.0",
    apiKey: env.ANVIL_API_KEY || "",
    sessionTimeoutMs,
    rateLimitRpm,
    maxSessions,
    poolSize,
    webhookUrl,
    evaluateTimeoutMs,
    harMaxEntries,
    persistPath: env.ANVIL_PERSIST_PATH || "",
  };
}
