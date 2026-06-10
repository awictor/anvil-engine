export declare const counters: {
    sessionsCreated: number;
    sessionsReleased: number;
    peakConcurrent: number;
    requestsServed: number;
    errorsCount: number;
    webhooksFailed: number;
};
export declare function normalizeRoute(method: string, pathname: string): string;
export declare function recordRequest(method: string, pathname: string, status: number, durationMs: number): void;
export interface EndpointStats {
    count: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    errors: number;
}
export declare function snapshot(): Record<string, EndpointStats>;
export declare function resetForTests(): void;
