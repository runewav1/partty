type TimingBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
  minMs: number;
  lastMs: number;
};

export type ParttyPerfSnapshot = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timings: Record<string, TimingBucket>;
};

const counters: Record<string, number> = {};
const gauges: Record<string, number> = {};
const timings: Record<string, TimingBucket> = {};
let consoleTimer = 0;
let frameRaf = 0;
let frameLast = 0;
let frameWindowStarted = 0;
let frameCount = 0;

const paneCounters = new Map<string, Record<string, number>>();
const paneGauges = new Map<string, Record<string, number>>();
const paneTimings = new Map<string, Record<string, TimingBucket>>();

type ThroughputWindow = {
  entries: Array<{ time: number; bytes: number }>;
  total: number;
};

const ptyInputThroughput = new Map<string, ThroughputWindow>();
const ptyOutputThroughput = new Map<string, ThroughputWindow>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem("partty.perf") === "1" || new URLSearchParams(location.search).has("parttyPerf");
  } catch {
    return false;
  }
}

function readConsoleEnabled(): boolean {
  try {
    return localStorage.getItem("partty.perf.console") === "1" || new URLSearchParams(location.search).has("parttyPerfConsole");
  } catch {
    return false;
  }
}

function readIntervalMs(): number {
  try {
    const raw = localStorage.getItem("partty.perf.intervalMs");
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? Math.max(1000, Math.min(60000, n)) : 5000;
  } catch {
    return 5000;
  }
}

function clearConsoleTimer(): void {
  if (consoleTimer) {
    window.clearInterval(consoleTimer);
    consoleTimer = 0;
  }
}

function syncConsoleTimer(): void {
  clearConsoleTimer();
  if (!parttyPerf.enabled || !parttyPerf.consoleEnabled) return;
  consoleTimer = window.setInterval(() => {
    console.debug("[partty:perf]", parttyPerf.snapshot());
  }, parttyPerf.consoleIntervalMs);
}

function startFrameProbe(): void {
  if (frameRaf || !parttyPerf.enabled) return;
  frameLast = performance.now();
  frameWindowStarted = frameLast;
  frameCount = 0;
  const tick = (now: number): void => {
    if (!parttyPerf.enabled) {
      frameRaf = 0;
      return;
    }
    const delta = now - frameLast;
    frameLast = now;
    frameCount++;
    parttyPerf.mark("frame.count");
    parttyPerf.time("frame.delta.ms", delta);
    if (delta > 50) parttyPerf.mark("frame.long_50ms");
    if (delta > 100) parttyPerf.mark("frame.long_100ms");
    const elapsed = now - frameWindowStarted;
    if (elapsed >= 1000) {
      parttyPerf.gauge("frame.fps", (frameCount * 1000) / elapsed);
      frameWindowStarted = now;
      frameCount = 0;
    }
    frameRaf = requestAnimationFrame(tick);
  };
  frameRaf = requestAnimationFrame(tick);
}

function stopFrameProbe(): void {
  if (frameRaf) cancelAnimationFrame(frameRaf);
  frameRaf = 0;
}

function installPerformanceObservers(): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        parttyPerf.time(`paint.${entry.name}.ms`, entry.startTime);
        parttyPerf.mark("paint.entries");
      }
    });
    paintObserver.observe({ type: "paint", buffered: true });
  } catch {
    /* unsupported in some WebView2 builds */
  }
  try {
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        parttyPerf.mark("main.longtask.count");
        parttyPerf.time("main.longtask.ms", entry.duration);
      }
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
  } catch {
    /* unsupported in some WebView2 builds */
  }
  try {
    const layoutShiftObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const value = (entry as PerformanceEntry & { value?: number }).value;
        if (typeof value === "number") {
          parttyPerf.mark("layout.shift.count");
          parttyPerf.gauge("layout.shift.last", value);
        }
      }
    });
    layoutShiftObserver.observe({ type: "layout-shift", buffered: true });
  } catch {
    /* unsupported in some WebView2 builds */
  }
}

const inputEventTimes: number[] = [];

export const parttyPerf = {
  enabled: readEnabled(),
  consoleEnabled: readConsoleEnabled(),
  consoleIntervalMs: readIntervalMs(),
  observersInstalled: false,
  configure(opts: { enabled?: boolean; consoleEnabled?: boolean; consoleIntervalMs?: number; reset?: boolean }): void {
    const wasEnabled = this.enabled;
    if (typeof opts.enabled === "boolean") this.enabled = opts.enabled;
    if (typeof opts.consoleEnabled === "boolean") this.consoleEnabled = opts.consoleEnabled;
    if (typeof opts.consoleIntervalMs === "number" && Number.isFinite(opts.consoleIntervalMs)) {
      this.consoleIntervalMs = Math.max(1000, Math.min(60000, Math.floor(opts.consoleIntervalMs)));
    }
    try {
      localStorage.setItem("partty.perf", this.enabled ? "1" : "0");
      localStorage.setItem("partty.perf.console", this.consoleEnabled ? "1" : "0");
      localStorage.setItem("partty.perf.intervalMs", String(this.consoleIntervalMs));
    } catch {
      /* localStorage unavailable */
    }
    if (opts.reset) this.reset();
    if (this.enabled && !this.observersInstalled) {
      this.observersInstalled = true;
      installPerformanceObservers();
    }
    if (this.enabled) startFrameProbe();
    else stopFrameProbe();
    syncConsoleTimer();
    if (!wasEnabled && this.enabled) this.mark("perf.enabled");
  },
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
    const bucket = timings[name] ?? { count: 0, totalMs: 0, maxMs: 0, minMs: Number.POSITIVE_INFINITY, lastMs: 0 };
    bucket.count++;
    bucket.totalMs += ms;
    bucket.maxMs = Math.max(bucket.maxMs, ms);
    bucket.minMs = Math.min(bucket.minMs, ms);
    bucket.lastMs = ms;
    timings[name] = bucket;
  },
  measure(name: string, start: number): void {
    this.time(name, performance.now() - start);
  },
  snapshot(): ParttyPerfSnapshot {
    return {
      counters: { ...counters },
      gauges: { ...gauges },
      timings: Object.fromEntries(
        Object.entries(timings).map(([key, value]) => [key, { ...value }]),
      ),
    };
  },
  paneMark(paneId: string, name: string, amount = 1): void {
    if (!this.enabled) return;
    let bucket = paneCounters.get(paneId);
    if (!bucket) {
      bucket = {};
      paneCounters.set(paneId, bucket);
    }
    bucket[name] = (bucket[name] ?? 0) + amount;
  },
  paneGauge(paneId: string, name: string, value: number): void {
    if (!this.enabled || !Number.isFinite(value)) return;
    let bucket = paneGauges.get(paneId);
    if (!bucket) {
      bucket = {};
      paneGauges.set(paneId, bucket);
    }
    bucket[name] = value;
  },
  paneTime(paneId: string, name: string, ms: number): void {
    if (!this.enabled || !Number.isFinite(ms)) return;
    let bucket = paneTimings.get(paneId);
    if (!bucket) {
      bucket = {};
      paneTimings.set(paneId, bucket);
    }
    const entry = bucket[name] ?? { count: 0, totalMs: 0, maxMs: 0, minMs: Number.POSITIVE_INFINITY, lastMs: 0 };
    entry.count++;
    entry.totalMs += ms;
    entry.maxMs = Math.max(entry.maxMs, ms);
    entry.minMs = Math.min(entry.minMs, ms);
    entry.lastMs = ms;
    bucket[name] = entry;
  },
  paneMeasure(paneId: string, name: string, start: number): void {
    this.paneTime(paneId, name, performance.now() - start);
  },
  getPaneSnapshot(paneId: string): ParttyPerfSnapshot | null {
    const counters = paneCounters.get(paneId);
    const gauges = paneGauges.get(paneId);
    const timings = paneTimings.get(paneId);
    if (!counters && !gauges && !timings) return null;
    return {
      counters: counters ? { ...counters } : {},
      gauges: gauges ? { ...gauges } : {},
      timings: timings ? Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, { ...v }])) : {},
    };
  },
  getAllPaneIds(): string[] {
    const ids = new Set<string>();
    for (const id of paneCounters.keys()) ids.add(id);
    for (const id of paneGauges.keys()) ids.add(id);
    for (const id of paneTimings.keys()) ids.add(id);
    return Array.from(ids).sort();
  },
  resetPane(paneId: string): void {
    paneCounters.delete(paneId);
    paneGauges.delete(paneId);
    paneTimings.delete(paneId);
    ptyInputThroughput.delete(paneId);
    ptyOutputThroughput.delete(paneId);
  },
  recordPtyInputBytes(paneId: string, bytes: number): void {
    if (!this.enabled || bytes <= 0) return;
    let w = ptyInputThroughput.get(paneId);
    if (!w) {
      w = { entries: [], total: 0 };
      ptyInputThroughput.set(paneId, w);
    }
    const now = performance.now();
    w.entries.push({ time: now, bytes });
    w.total += bytes;
    this.paneMark(paneId, "pty.input.bytes", bytes);
    const cutoff = now - 1000;
    while (w.entries.length > 0 && w.entries[0].time < cutoff) w.entries.shift();
  },
  recordPtyOutputBytes(paneId: string, bytes: number): void {
    if (!this.enabled || bytes <= 0) return;
    let w = ptyOutputThroughput.get(paneId);
    if (!w) {
      w = { entries: [], total: 0 };
      ptyOutputThroughput.set(paneId, w);
    }
    const now = performance.now();
    w.entries.push({ time: now, bytes });
    w.total += bytes;
    this.paneMark(paneId, "pty.output.bytes", bytes);
    const cutoff = now - 1000;
    while (w.entries.length > 0 && w.entries[0].time < cutoff) w.entries.shift();
  },
  getPtyInputRate(paneId: string): { bytesPerSec: number; totalBytes: number } | null {
    const w = ptyInputThroughput.get(paneId);
    if (!w || w.entries.length === 0) return null;
    const cutoff = performance.now() - 1000;
    const recent = w.entries.filter((e) => e.time >= cutoff);
    const bytesPerSec = recent.reduce((s, e) => s + e.bytes, 0);
    return { bytesPerSec, totalBytes: w.total };
  },
  getPtyOutputRate(paneId: string): { bytesPerSec: number; totalBytes: number } | null {
    const w = ptyOutputThroughput.get(paneId);
    if (!w || w.entries.length === 0) return null;
    const cutoff = performance.now() - 1000;
    const recent = w.entries.filter((e) => e.time >= cutoff);
    const bytesPerSec = recent.reduce((s, e) => s + e.bytes, 0);
    return { bytesPerSec, totalBytes: w.total };
  },
  recordInputEvent(): void {
    if (!this.enabled) return;
    const now = performance.now();
    inputEventTimes.push(now);
    const cutoff = now - 200;
    while (inputEventTimes.length > 0 && inputEventTimes[0] < cutoff) inputEventTimes.shift();
    this.gauge("input.events.200ms", inputEventTimes.length);
  },
  getInputRate(): number {
    const cutoff = performance.now() - 1000;
    const recent = inputEventTimes.filter((t) => t >= cutoff);
    return recent.length;
  },
  reset(): void {
    for (const key of Object.keys(counters)) delete counters[key];
    for (const key of Object.keys(gauges)) delete gauges[key];
    for (const key of Object.keys(timings)) delete timings[key];
    paneCounters.clear();
    paneGauges.clear();
    paneTimings.clear();
    ptyInputThroughput.clear();
    ptyOutputThroughput.clear();
    inputEventTimes.length = 0;
  },
};

declare global {
  interface Window {
    __parttyPerf?: typeof parttyPerf;
  }
}

window.__parttyPerf = parttyPerf;
parttyPerf.configure({
  enabled: parttyPerf.enabled,
  consoleEnabled: parttyPerf.consoleEnabled,
  consoleIntervalMs: parttyPerf.consoleIntervalMs,
});
