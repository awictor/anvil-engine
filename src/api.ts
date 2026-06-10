import { loadConfig, ConfigError } from "./config.js";
import { createLogger } from "./logger.js";
import { buildApp } from "./app.js";

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

async function shutdown(signal: string) {
  logger.info(`${signal} — stopping server`, { sessions: app.sessionManager.size });
  await app.stop();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message });
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
});

(async () => {
  await app.start();
  app.server.listen(config.port, config.host, () => {
    logger.info(`Running on http://${config.host}:${config.port}`);
    logger.info(`CDP proxy on ws://${config.host}:${config.port}/cdp`);
    logger.info(`Auth: ${config.apiKey ? "API key enabled" : "disabled (dev mode)"}`);
    logger.info(`Session timeout: ${config.sessionTimeoutMs > 0 ? `${config.sessionTimeoutMs}ms` : "disabled"}`);
  });
})();
