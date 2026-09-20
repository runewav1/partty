/**
 * Compile-time parity guard between the dev metrics collector and the
 * production no-op stub.
 *
 * `vite.config.ts` aliases `pty/perf.ts` → `pty/perf.stub.ts` only at build
 * time, and nothing imports both modules, so `tsc` would otherwise never
 * compare them. Without this guard a method added to the dev collector (and
 * called from `main.ts`, `paneHost.ts`, `devMetricsOverlay.ts`) could be
 * missing from the stub and only fail at runtime in production.
 *
 * This file is type-only and is not imported by any entry, so it emits no
 * runtime code and is not bundled. If the stub stops satisfying the dev
 * collector's shape, `tsc` fails here.
 */

type DevCollector = typeof import("../../pty/perf").parttyPerf;
type StubCollector = typeof import("../../pty/perf.stub").parttyPerf;

type Assert<_T extends true> = true;

export type StubSatisfiesDevCollector = Assert<
	StubCollector extends DevCollector ? true : false
>;
