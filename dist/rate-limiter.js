export class RateLimiter {
    buckets = new Map();
    maxTokens;
    refillRate;
    cleanupTimer = null;
    constructor(requestsPerMinute) {
        this.maxTokens = requestsPerMinute;
        this.refillRate = requestsPerMinute / 60;
    }
    consume(clientId) {
        const now = Date.now();
        let bucket = this.buckets.get(clientId);
        if (!bucket) {
            bucket = { tokens: this.maxTokens, lastRefill: now };
            this.buckets.set(clientId, bucket);
        }
        const elapsed = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
        bucket.lastRefill = now;
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return { allowed: true, retryAfterSec: 0 };
        }
        const retryAfterSec = Math.ceil((1 - bucket.tokens) / this.refillRate);
        return { allowed: false, retryAfterSec };
    }
    startCleanup() {
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [id, bucket] of this.buckets) {
                if (now - bucket.lastRefill > 120_000) {
                    this.buckets.delete(id);
                }
            }
        }, 60_000);
    }
    stopCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}
