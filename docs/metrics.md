# Developer Metrics Contract

DEV-only metrics collector. **No instrumentation is present in production builds**: Vite aliases `src/pty/perf.ts` to `src/pty/perf.stub.ts` in `production` mode, so the stub runs with identical signatures, zero runtime imports (type-only imports only), and zero runtime cost.

## Enabling

Collector state is read at module load and re-applied through `configure()`:

- `localStorage["partty.perf"] === "1"` or URL `?parttyPerf` → enabled
- `localStorage["partty.perf.console"] === "1"` or URL `?parttyPerfConsole` → console dumps
- `localStorage["partty.perf.intervalMs"]` (clamped 1000–60000, default 5000) → console dump interval

The app boot path calls `parttyPerf.configure({ enabled, consoleEnabled, consoleIntervalMs })`. Every metric call short-circuits when `enabled` is false.

## Public API

All methods are identity-shaped on the dev collector and the production stub.

```ts
configure(opts: {
  enabled?: boolean;
  consoleEnabled?: boolean;
  consoleIntervalMs?: number;
  reset?: boolean;
}): void

mark(name: string, amount?: number): void            // counter += amount (default 1); ignores NaN and negative
gauge(name: string, value: number): void              // last-value wins; NaN/Inf ignored
time(name: string, ms: number): void                  // cumulative session bucket; ignores NaN and negative
measure(name: string, start: number): void            // time(name, performance.now() - start)
paneMark(paneId, name, amount?): void
paneGauge(paneId, name, value): void
paneTime(paneId, name, ms): void
paneMeasure(paneId, name, start): void

snapshot(): ParttyPerfSnapshot                        // deeply frozen; sweeps expired tokens
snapshotJson(): string                                // JSON.stringify(snapshot())
toJSON(): ParttyPerfSnapshot                          // JSON.stringify(parttyPerf) passthrough
contracts(): readonly MetricContract[]                // frozen metadata table

getPaneSnapshot(paneId): PanePerfSnapshot | null      // null when the pane is untracked; sweeps expired tokens
getAllPaneIds(): string[]

recordPtyInputBytes(paneId, bytes): void              // real byte inputs from the parent
recordPtyOutputBytes(paneId, bytes): void             // real byte outputs from the parent
getPtyInputRate(paneId): RateSummary | null
getPtyOutputRate(paneId): RateSummary | null
recordInputEvent(): void                              // terminal onData event
getInputRate(): number                                // onData events in the trailing 1s

beginTermWrite(paneId: string, bytes: number): WriteToken
finishTermWrite(token: WriteToken): void
cancelTermWrite(token: WriteToken): void              // for a synchronous write() throw

reset(): void
resetPane(paneId): void
dispose(): void
```

## Term write tokens

`beginTermWrite(paneId, bytes)` returns a token; `finishTermWrite(token)` is intended to run in the
`term.write(data, callback)` **completion callback** — the callback fires once xterm has parsed the
data into its buffer. That span is **handed-to-write → write-completion-callback latency only**:
not a pure enqueue point, never parse-CPU-as-a-separate-metric, never render/presentation.

- **Bounded**: at most `256` in-flight tokens. When full, the oldest is evicted and counted as `overflow`.
- **Expiry**: tokens older than `2000ms` count as `expired` and contribute no latency sample. Expiry is
  enforced on finish, on every begin, and **swept eagerly by `snapshot()` / `getPaneSnapshot()`** so a
  token whose callback never fires cannot stay `outstanding` forever; the sweep attributes `expired`
  per pane.
- **Epoch-safe**: `reset()`, `resetPane()`, `dispose()`, and **disabling** cancel in-flight tokens and
  bump the epoch; a late `finishTermWrite` for a cancelled token is a no-op (`ignored`) and can never
  complete or corrupt a newer token (ids are monotonic and never reused).
- **Disable**: cancels pending tokens (preserving completed/expired/overflow counts) so re-enabling
  never lets a callback spanning the disabled period count as fresh latency.
- **`cancelTermWrite(token)`**: cancels a single pending token (counted `cancelled`) — call it from the
  parent when `term.write()` throws synchronously.
- **Counts** (`writeTokens`, global in `snapshot()`, per-pane in `getPaneSnapshot()`):
  `started`, `outstanding`, `completed`, `expired`, `cancelled`, `overflow` —
  reconciling as `started = outstanding + completed + expired + cancelled + overflow`.

Integration shape for the parent:

```ts
// enqueue side (previously parttyPerf.beginTermWrite(paneId) — now returns a token):
const token = parttyPerf.enabled ? parttyPerf.beginTermWrite(paneId, data.length) : null;

// completion side (previously parttyPerf.finishTermRender(id) from onRender):
try {
  pt.term.write(data, () => { if (token) parttyPerf.finishTermWrite(token); });
} catch (e) {
  if (token) parttyPerf.cancelTermWrite(token);
  throw e;
}
```

## Parent integration notes (generic metrics)

- `xterm.write.call.ms` measures synchronous wall time from calling `term.write` until it returns.
  It may include immediate parsing and instrumentation callbacks on xterm's input-response fast path.
  It is neither isolated parse CPU nor rendering time. The separate `writeLatency` token metric
  measures from registration before the call until its completion callback, including deferred work.
- `recordPtyOutputBytes(paneId, bytes)` — pass the byte count **actually handed to `term.write`**
  (output handed-to-write boundary), not an upstream event size.
- `recordPtyInputBytes(paneId, bytes)` — pass the **UTF-8 byte length** of the requested input string
  (e.g. `new TextEncoder().encode(data).byteLength`), not UTF-16 code-unit length.

## Snapshot shape

```ts
type TimingBucket = { count: number; totalMs: number; maxMs: number; minMs: number; lastMs: number };

type LatencySummary = {
  windowMs: number;          // rolling window length (10000 for write latency and rAF gaps)
  capacity: number;          // max stored samples (4096)
  n: number;                 // samples currently in the rolling window
  p50: number | null;        // null when n === 0 (unavailable)
  p95: number | null;        // null when n === 0 (unavailable)
  max: number | null;        // null when n === 0
  last: number | null;       // most recent sample; null before the first sample
  avgMs: number | null;      // session average = totalSumMs / total
  evictions: number;         // samples dropped at capacity (bounded window, not full population)
  total: number;             // session total samples recorded
  totalSumMs: number;        // session total latency sum
};

type RateSummary = {
  windowMs: number;          // 1000ms trailing window
  capacity: number;          // 4096
  samples: number;           // events inside the window
  spanMs: number;            // newest - oldest sample time inside the window
  bytesInWindow: number;     // raw byte sum inside the window
  bytesPerSec: number;       // bytesInWindow (trailing 1s rate; raw sum, see note)
  totalBytes: number;        // session total bytes (separate from the window; correct across evictions)
  lastBytes: number;         // most recent byte count
  evictions: number;         // capacity drops (visible so a bounded window is not mistaken for the population)
};

type TokenCounts = {
  started: number;           // started === outstanding + completed + expired + cancelled + overflow
  outstanding: number;
  completed: number;
  expired: number;
  cancelled: number;
  overflow: number;
};

type RafState = {
  state: "active" | "paused";   // paused = disabled or document hidden (never labeled active while hidden)
  pausedAt: number | null;
  staleMs: number;              // time since the last rAF sample (grows while paused/hidden)
  gap: LatencySummary;          // rolling inter-frame gap distribution
};

type PerfSessionMetadata = {
  schemaVersion: number;        // 2
  capturedAt: number;           // performance.now() at snapshot build (monotonic)
  sessionStartedAt: number | null;  // performance.now() at last disable→enable transition
  epoch: number;                // write-token epoch (bumped by reset/reset/dispose/disable-cancel)
  enabled: boolean;
};

type ParttyPerfSnapshot = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timings: Record<string, TimingBucket>;
  rates: { in: RateSummary; out: RateSummary };   // global across panes
  writeLatency: LatencySummary;                   // global across panes
  writeTokens: TokenCounts;
  rAF: RafState;
  meta: PerfSessionMetadata;
};

type PanePerfSnapshot = {
  capturedAt: number;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timings: Record<string, TimingBucket>;
  rates: { in: RateSummary | null; out: RateSummary | null };
  writeLatency: LatencySummary | null;
  writeTokens: TokenCounts;
};
```

`snapshot()`, `snapshotJson()`, `contracts()`, `getPaneSnapshot()`, `getPtyInputRate()`, and
`getPtyOutputRate()` all return **deeply frozen / copied** values; mutating the returned object throws.
`snapshot()` and `getPaneSnapshot()` sweep expired write tokens as a side effect (see tokens above).

## Metric contracts

`contracts()` returns this frozen table (kind/unit/window/sample counts). Unavailable semantics:
`p50`/`p95`/`max` are `null` when the window is empty; per-pane rates and pane snapshots are `null`
when the pane has no data; `observer.longtask`/`observer.layout-shift` are absent until the first
install so a panel can distinguish unsupported (`0`) from supported-with-zero-events.

| name | kind | unit | windowMs | maxSamples | availability | semantics |
| --- | --- | --- | --- | --- | --- | --- |
| `rAF.gap.50ms` | counter | count | — | — | dev-only | rAF callbacks with inter-frame gap > 50ms |
| `rAF.gap.100ms` | counter | count | — | — | dev-only | rAF callbacks with inter-frame gap > 100ms |
| `main.longtask.count` | counter | count | — | — | dev-only | long tasks since install/reset; initialized to 0 when supported |
| `main.longtask.ms` | timing | ms | — | — | dev-only | long task durations, cumulative session bucket |
| `layout.shift.count` | counter | count | — | — | dev-only | layout shifts since install/reset; initialized to 0 when supported |
| `layout.shift.last` | gauge | score | — | — | dev-only | most recent layout shift score |
| `observer.longtask` | gauge | 1 | — | — | dev-only | 1 installed / 0 unsupported; absent before first install |
| `observer.layout-shift` | gauge | 1 | — | — | dev-only | 1 installed / 0 unsupported; absent before first install |
| `pty.input` | rate | bytes/s | 1000 | 4096 | dev-only | actual PTY input bytes from the parent |
| `pty.output` | rate | bytes/s | 1000 | 4096 | dev-only | actual PTY output bytes from the parent |
| `input.events` | rate | events/s | 1000 | 4096 | dev-only | terminal onData events |
| `write.enqueue.calls` | counter | count | — | — | dev-only | term write opens |
| `write.enqueue.bytes` | counter | bytes | — | — | dev-only | bytes handed into term writes |
| `write.latency.ms` | latency | ms | 10000 | 4096 | dev-only | handed-to-write → completion-callback latency |
| `write.tokens` | token | count | — | 256 | dev-only | token lifecycle counts (reconciled via `started`) |
| `rAF.gap` | latency | ms | 10000 | 4096 | dev-only | rAF callback cadence (not FPS) |
| `rAF.state` | state | 1 | — | — | dev-only | active/paused sampling state |

Caller-defined names passed to `mark`/`gauge`/`time`/`pane*` flow through the generic
`counters`/`gauges`/`timings` maps and are not listed in `contracts()`.

## Accuracy rules

- **Rolling windows are bounded, not pretend-total populations.** `LatencySummary.evictions` counts
  capacity drops; `n` is the live window; `total`/`totalSumMs` are session totals labeled separately.
  Age-outs are excluded from `n` on read without mutating the window.
- **One-second rates come from actual byte inputs the parent passes** (`recordPtyInputBytes` /
  `recordPtyOutputBytes`). `bytesPerSec` equals the trailing 1s raw sum; `samples`/`spanMs`/`totalBytes`
  qualify it, and `evictions` stay visible so a bounded window is never mistaken for the population.
  `input.events` counts real `onData` events.
- **rAF is cadence/gaps only** — never labeled FPS or presentation. The loop pauses while the document
  is hidden and `rAF.state`/`staleMs` expose that explicitly; enabling while already hidden labels the
  state `paused`, not `active`; the first frame after a resume is skipped so the hidden period cannot
  contaminate the gap window.
- **Observers start at an unbuffered boundary** (`buffered: false`) so pre-enable entries never leak in,
  and are disconnected on disable. `reset()` calls `takeRecords()`/discards queued records so pre-reset
  entries cannot be counted after a reset.
- **No fabricated measures**: no fake PTY RTT probes, no write→render probe, no GPU/parse/presentation
  timing, no rVFC (video-only concept, not applicable to the terminal). The only timings emitted are the
  real `main.longtask.ms` durations and the write-completion-callback latency.
- **Input validation**: `mark`/`paneMark` ignore non-finite and negative amounts; `time`/`paneTime`
  ignore non-finite and negative values; rates ignore non-finite and non-positive byte counts.

## Removal note

The former `beginPtyRoundtrip`/`completePtyRoundtrip` (echo-based fake RTT) and `finishTermRender`
(write→render probe) APIs are **removed**; `beginTermWrite(paneId)` changed to
`beginTermWrite(paneId, bytes): WriteToken` plus `finishTermWrite(token)` and `cancelTermWrite(token)`.
The parent must migrate those four call sites in `src/main.ts` (see the term-write integration shape
above) and drop the `xterm.render.ms`/`xterm.write.ms` labels in favor of the token API / generic
`xterm.write.call.ms`.
