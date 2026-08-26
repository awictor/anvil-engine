// DEV-0112: anvil exposes /v1/metrics + /v1/health on request, but emits no PERIODIC ops line — so a
// 24/7 self-hosted box (the infra relay + DataFaucet both run on) gives an operator no time-series
// health from logs alone. This is a wall-clock heartbeat: on an interval it calls emit() (log a
// compact metrics line). Pure/injectable — the caller passes emit + a setInterval/clearInterval pair,
// so it's unit-tested with a mock clock, no real timers. Mirrors relay's makeMetricsHeartbeat.

export interface MetricsHeartbeat {
  tick(): void;   // one emit (used by tests + the interval)
  start(): void;  // begin the interval (no-op if periodMs <= 0 or already started)
  stop(): void;   // clear the interval
}

export interface MetricsHeartbeatDeps {
  emit: () => void;                                           // e.g. () => logger.info("metrics", snapshotFields())
  periodMs: number;                                           // 0 (or <=0) disables the interval
  setInterval?: (fn: () => void, ms: number) => unknown;      // injectable for tests
  clearInterval?: (h: unknown) => void;
  onError?: (e: unknown) => void;                             // a throwing emit must not kill the timer
}

export function makeMetricsHeartbeat(deps: MetricsHeartbeatDeps): MetricsHeartbeat {
  let handle: unknown = null;
  const setI = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearI = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

  function tick(): void {
    // emit is observability — a failure must never crash the worker or stop the beat.
    try { deps.emit(); } catch (e) { deps.onError?.(e); }
  }

  return {
    tick,
    start() {
      if (deps.periodMs <= 0 || handle !== null) return;
      handle = setI(() => { tick(); }, deps.periodMs);
    },
    stop() {
      if (handle !== null) { clearI(handle); handle = null; }
    },
  };
}
