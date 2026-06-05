type TimingBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
};

export type TermiePerfSnapshot = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timings: Record<string, TimingBucket>;
};

const counters: Record<string, number> = {};
const gauges: Record<string, number> = {};
const timings: Record<string, TimingBucket> = {};

function readEnabled(): boolean {
  try {
    return localStorage.getItem("termie.perf") === "1" || new URLSearchParams(location.search).has("termiePerf");
  } catch {
    return false;
  }
}

export const termiePerf = {
  enabled: readEnabled(),
  mark(name: string, amount = 1): void {
    if (!this.enabled) return;
    counters[name] = (counters[name] ?? 0) + amount;
  },
  gauge(name: string, value: number): void {
    if (!this.enabled || !Number.isFinite(value)) return;
    gauges[name] = value;
  },
  time(name: string, ms: number): void {
    if (!this.enabled || !Number.isFinite(ms)) return;
    const bucket = timings[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
    bucket.count++;
    bucket.totalMs += ms;
    bucket.maxMs = Math.max(bucket.maxMs, ms);
    timings[name] = bucket;
  },
  measure(name: string, start: number): void {
    this.time(name, performance.now() - start);
  },
  snapshot(): TermiePerfSnapshot {
    return {
      counters: { ...counters },
      gauges: { ...gauges },
      timings: Object.fromEntries(
        Object.entries(timings).map(([key, value]) => [key, { ...value }]),
      ),
    };
  },
  reset(): void {
    for (const key of Object.keys(counters)) delete counters[key];
    for (const key of Object.keys(gauges)) delete gauges[key];
    for (const key of Object.keys(timings)) delete timings[key];
  },
};

declare global {
  interface Window {
    __termiePerf?: typeof termiePerf;
  }
}

if (termiePerf.enabled) {
  window.__termiePerf = termiePerf;
  window.setInterval(() => {
    const snap = termiePerf.snapshot();
    console.debug("[termie:perf]", snap);
  }, 5000);
}
