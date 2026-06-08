interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private maxTokens: number;
  private refillRate: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(requestsPerMinute: number) {
    this.maxTokens = requestsPerMinute;
    this.refillRate = requestsPerMinute / 60;
  }

  consume(clientId: string): { allowed: boolean; retryAfterSec: number } {
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

  startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, bucket] of this.buckets) {
        if (now - bucket.lastRefill > 120_000) {
          this.buckets.delete(id);
        }
      }
    }, 60_000);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
