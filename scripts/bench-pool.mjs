// Bench (m6 anvil-bench-1): prove the warm-pool acquire is faster than a cold launch.
// Times N pool.acquire() from a pre-warmed pool vs N cold launchBrowser(), prints the
// per-acquire latency delta. Live — needs Chrome. Run: npx tsx scripts/bench-pool.mjs
// (or `node` after build against dist). Not in CI (no browser there).
import { BrowserPool } from "../src/pool.ts";
import { launchBrowser, killBrowser } from "../src/launcher.ts";

const N = Number(process.env.BENCH_N ?? 5);
const opts = { headless: true, stealth: true };

function ms(t) { return `${t.toFixed(0)}ms`; }
async function time(fn) { const s = Date.now(); await fn(); return Date.now() - s; }

// --- cold: launch + kill, N times sequentially ---
let coldTotal = 0;
for (let i = 0; i < N; i++) {
  const t = await time(async () => { const p = await launchBrowser(opts); await killBrowser(p); });
  coldTotal += t;
}
const coldAvg = coldTotal / N;

// --- warm: pre-warm a pool of N, then acquire N (each an instant pop) ---
const pool = new BrowserPool(N);
const warmMs = await time(() => pool.init());       // one-time pre-warm cost (amortized/at boot)
let acqTotal = 0;
for (let i = 0; i < N; i++) {
  const p = await time(async () => { const proc = await pool.acquire(opts); pool.release(proc); });
  acqTotal += p;
}
const acqAvg = acqTotal / N;
await pool.shutdown();

console.log(`\nbench N=${N}`);
console.log(`  cold launch avg:   ${ms(coldAvg)}/op`);
console.log(`  warm acquire avg:  ${ms(acqAvg)}/op   (pre-warm ${ms(warmMs)} once at boot)`);
const speedup = coldAvg > 0 ? (coldAvg / Math.max(1, acqAvg)) : 0;
console.log(`  warm acquire is ~${speedup.toFixed(1)}x faster per op (pre-warm moves the cost to boot)`);

// The claim: a warm acquire (pop) should be dramatically faster than a cold launch.
if (acqAvg < coldAvg) { console.log("\nBENCH PASS: warm-pool acquire beats cold launch per op"); process.exit(0); }
console.error("\nBENCH FAIL: warm acquire not faster than cold — investigate"); process.exit(1);
