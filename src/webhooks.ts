const WEBHOOK_URL = process.env.ANVIL_WEBHOOK_URL || "";

export type WebhookEvent = "session.created" | "session.released" | "session.timed_out";

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
    .catch((err) => {
      process.stderr.write(`[anvil-engine] Webhook failed: ${err.message}\n`);
    })
    .finally(() => clearTimeout(timeout));
}
