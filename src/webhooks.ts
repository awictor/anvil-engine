import { createLogger } from "./logger.js";
import { counters } from "./metrics.js";

const WEBHOOK_URL = process.env.ANVIL_WEBHOOK_URL || "";
const logger = createLogger("webhooks");

export type WebhookEvent = "session.created" | "session.released" | "session.timed_out" | "session.stuck";

export function fireWebhook(event: WebhookEvent, sessionId: string): void {
  if (!WEBHOOK_URL) return;

  const payload = {
    event,
    sessionId,
    timestamp: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) {
        counters.webhooksFailed++;
        logger.warn("Webhook returned non-2xx", { event, sessionId, status: res.status });
      }
    })
    .catch((err) => {
      counters.webhooksFailed++;
      logger.warn("Webhook failed", { event, sessionId, error: err.message });
    })
    .finally(() => clearTimeout(timeout));
}
