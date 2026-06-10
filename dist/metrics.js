const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
// Legacy counters — /v1/metrics consumers and tests pin these exact keys.
export const counters = {
    sessionsCreated: 0,
    sessionsReleased: 0,
    peakConcurrent: 0,
    requestsServed: 0,
    errorsCount: 0,
    webhooksFailed: 0,
};
const histograms = new Map();
const errorsByEndpoint = new Map();
// Collapse path params so histogram cardinality stays bounded.
export function normalizeRoute(method, pathname) {
    let route = pathname;
    const sessionMatch = pathname.match(/^\/v1\/sessions\/([^/]+)(\/release)?$/);
    if (sessionMatch && sessionMatch[1] !== "list") {
        route = sessionMatch[2] ? "/v1/sessions/:id/release" : "/v1/sessions/:id";
    }
    else if (/^\/v1\/downloads\/.+$/.test(pathname)) {
        route = "/v1/downloads/:filename";
    }
    return `${method} ${route}`;
}
export function recordRequest(method, pathname, status, durationMs) {
    counters.requestsServed++;
    if (status >= 400)
        counters.errorsCount++;
    const key = normalizeRoute(method, pathname);
    let h = histograms.get(key);
    if (!h) {
        h = { buckets: new Array(BUCKETS_MS.length + 1).fill(0), count: 0, sumMs: 0 };
        histograms.set(key, h);
    }
    h.count++;
    h.sumMs += durationMs;
    let i = BUCKETS_MS.findIndex((b) => durationMs <= b);
    if (i === -1)
        i = BUCKETS_MS.length;
    for (let j = i; j < h.buckets.length; j++)
        h.buckets[j]++;
    if (status >= 400) {
        errorsByEndpoint.set(key, (errorsByEndpoint.get(key) || 0) + 1);
    }
}
function percentile(h, p) {
    if (h.count === 0)
        return 0;
    const target = Math.ceil(h.count * p);
    for (let i = 0; i < BUCKETS_MS.length; i++) {
        if (h.buckets[i] >= target)
            return BUCKETS_MS[i];
    }
    return BUCKETS_MS[BUCKETS_MS.length - 1];
}
export function snapshot() {
    const out = {};
    for (const [key, h] of histograms) {
        out[key] = {
            count: h.count,
            avgMs: h.count > 0 ? Math.round(h.sumMs / h.count) : 0,
            p50Ms: percentile(h, 0.5),
            p95Ms: percentile(h, 0.95),
            p99Ms: percentile(h, 0.99),
            errors: errorsByEndpoint.get(key) || 0,
        };
    }
    return out;
}
export function resetForTests() {
    for (const key of Object.keys(counters))
        counters[key] = 0;
    histograms.clear();
    errorsByEndpoint.clear();
}
