import { loadConfig, ConfigError } from "./config.js";
import { createLogger } from "./logger.js";
import { buildApp } from "./app.js";
import { installProcessHandlers } from "./process-handlers.js";

const logger = createLogger("api");

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`[anvil-engine] ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const app = buildApp(config);

// SIGINT/SIGTERM -> graceful stop + exit 0; uncaughtException/unhandledRejection -> log + best-effort
// stop() (releases the pool, kills leaked Chrome) + exit 1. Previously the fatal handlers only logged,
// so a broken process kept running with orphaned browsers (DEV-0068).
installProcessHandlers({ logger, stop: () => app.stop() });

(async () => {
  await app.start();
  app.server.listen(config.port, config.host, () => {
    logger.info(`Running on http://${config.host}:${config.port}`);
    logger.info(`CDP proxy on ws://${config.host}:${config.port}/cdp`);
    logger.info(`Auth: ${config.apiKey ? "API key enabled" : "disabled (dev mode)"}`);
    logger.info(`Session timeout: ${config.sessionTimeoutMs > 0 ? `${config.sessionTimeoutMs}ms` : "disabled"}`);
  });
})();
