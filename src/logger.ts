type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel(): number {
  const env = (process.env.ANVIL_LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LEVEL_RANK[env] ?? LEVEL_RANK.info;
}

export interface LogFields {
  requestId?: string;
  sessionId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

function emit(level: LogLevel, module: string, msg: string, fields?: LogFields): void {
  if (LEVEL_RANK[level] < activeLevel()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    module,
    msg,
    ...fields,
  });
  process.stderr.write(line + "\n");
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg, fields) => emit("debug", module, msg, fields),
    info: (msg, fields) => emit("info", module, msg, fields),
    warn: (msg, fields) => emit("warn", module, msg, fields),
    error: (msg, fields) => emit("error", module, msg, fields),
  };
}
