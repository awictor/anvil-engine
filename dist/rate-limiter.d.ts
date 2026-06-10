export declare class RateLimiter {
    private buckets;
    private maxTokens;
    private refillRate;
    private cleanupTimer;
    constructor(requestsPerMinute: number);
    consume(clientId: string): {
        allowed: boolean;
        retryAfterSec: number;
    };
    startCleanup(): void;
    stopCleanup(): void;
}
