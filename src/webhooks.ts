import { createLogger } from "./logger.js";
import { counters } from "./metrics.js";

const WEBHOOK_URL = process.env.ANVIL_WEBHOOK_URL || "";
const logger = createLogger("webhooks");

export type WebhookEvent = "session.created" | "session.released" | "session.timed_out" | "session.stuck";

/**
 * Build the webhook POST body. Optional `detail` is merged in for self-describing alerts (e.g.
 * session.stuck carries {ageMs,inFlight}, DEV-0168), but the RESERVED keys event/sessionId/timestamp
 * always win — a detail key can't clobber them (spread detail FIRST). Pure + exported so the
 * reserved-key precedence is unit-testable without a network (DEV-0169). timestamp is injected so the
 * test is deterministic; fireWebhook passes new Date().toISOString().
 */
export function buildWebhookPayload(
  event: WebhookEvent, sessionId: string, timestamp: string, detail?: Record<string, unknown>,
): Record<string, unknown> {
  return { ...detail, event, sessionId, timestamp };
}

export function fireWebhook(event: WebhookEvent, sessionId: string, detail?: Record<string, unknown>): void {
  if (!WEBHOOK_URL) return;

  const payload = buildWebhookPayload(event, sessionId, new Date().toISOString(), detail);

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
