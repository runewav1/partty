export type ParttyPerfSnapshot = {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timings: Record<
    string,
    { count: number; totalMs: number; maxMs: number; minMs: number; lastMs: number }
  >;
};

const emptySnapshot = (): ParttyPerfSnapshot => ({
  counters: {},
  gauges: {},
  timings: {},
});

/** No-op perf collector — production builds alias `perf.ts` to this file. */
export const parttyPerf = {
  enabled: false,
  consoleEnabled: false,
  consoleIntervalMs: 5000,
  observersInstalled: false,
  configure(): void {},
  mark(): void {},
  gauge(): void {},
  time(): void {},
  measure(): void {},
  snapshot: emptySnapshot,
  paneMark(): void {},
  paneGauge(): void {},
  paneTime(): void {},
  paneMeasure(): void {},
  getPaneSnapshot(): null {
    return null;
  },
  getAllPaneIds(): string[] {
    return [];
  },
  resetPane(): void {},
  recordPtyInputBytes(): void {},
  recordPtyOutputBytes(): void {},
  getPtyInputRate(): null {
    return null;
  },
  getPtyOutputRate(): null {
    return null;
  },
  recordInputEvent(): void {},
  getInputRate(): number {
    return 0;
  },
  reset(): void {},
};
