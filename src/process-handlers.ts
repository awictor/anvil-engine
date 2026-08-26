import { type Logger } from "./logger.js";

export interface ProcessHandlerDeps {
  logger: Logger;
  // Graceful teardown: stops the HTTP/CDP server and releases the browser pool (kills Chrome procs).
  stop: () => Promise<void>;
  // Injectable so tests don't kill the runner. Defaults to process.exit.
  exit?: (code: number) => void;
}

/**
 * Wire the long-running server's process-level handlers.
 *
 * SIGINT/SIGTERM  -> graceful stop, exit 0 (intended shutdown; supervisor won't treat it as a crash).
 * uncaughtException / unhandledRejection -> log, best-effort stop(), exit 1.
 *
 * The fatal handlers previously ONLY logged, so a broken process kept running with LEAKED Chrome
 * processes and half-dead sessions. Exiting non-zero after stop() lets the pool release its browsers
 * and lets a supervisor (systemd/docker/pm2) restart into a clean state. A fatal error MUST end the
 * process — a browser-as-a-service that limps on after an unhandled fault leaks real OS resources.
 * Re-entrancy guarded so a rejection thrown during teardown can't loop.
 */
export function installProcessHandlers(deps: ProcessHandlerDeps): void {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  let handling = false;

  async function terminate(reason: string, code: number, detail?: unknown): Promise<void> {
    if (handling) return;
    handling = true;
    if (code === 0) {
      deps.logger.info(`${reason} — stopping server`);
    } else {
      deps.logger.error(`Fatal: ${reason}`, { detail: detail instanceof Error ? detail.message : String(detail) });
    }
    try {
      await deps.stop();
    } catch (e) {
      deps.logger.error("stop() failed during shutdown", { error: e instanceof Error ? e.message : String(e) });
    }
    exit(code);
  }

  process.on("SIGINT", () => void terminate("SIGINT", 0));
  process.on("SIGTERM", () => void terminate("SIGTERM", 0));
  process.on("uncaughtException", (err) => void terminate("uncaughtException", 1, err));
  process.on("unhandledRejection", (reason) => void terminate("unhandledRejection", 1, reason));
}
