export type WebhookEvent = "session.created" | "session.released" | "session.timed_out";
export declare function fireWebhook(event: WebhookEvent, sessionId: string): void;
