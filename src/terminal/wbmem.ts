import { invoke } from "@tauri-apps/api/core";

// Whole-page GC is a last step after a known disposal, never a periodic
// response to high memory or terminal repainting. Retained hidden windows
// use the native WebView2 memory policy instead.
const SETTLE_MS = 2_000;
const MIN_GAP_MS = 30_000;
const FAILURE_GAP_MS = 120_000;
const MAX_DEFER_MS = 45_000;
const IDLE_TIMEOUT_MS = 1_500;
const MIN_IDLE_BUDGET_MS = 8;

let timer: number | undefined;
let idle: number | undefined;
let expiresAt: number | undefined;
let quietAt = 0;
let nextAt = 0;
let running = false;
let off = false;
let warned = false;

export function cancelReclaim(): void {
	expiresAt = undefined;
	if (timer !== undefined) window.clearTimeout(timer);
	if (idle !== undefined) window.cancelIdleCallback(idle);
	timer = undefined;
	idle = undefined;
}

/** Cheap activity signal; no timers or IPC on the terminal's hot path. */
export function noteReclaimActivity(): void {
	if (expiresAt !== undefined) quietAt = performance.now() + SETTLE_MS;
}

/** Reclaim once after a burst of actual resource disposal. */
export function scheduleReclaim(): void {
	if (
		off ||
		typeof window === "undefined" ||
		!("__TAURI_INTERNALS__" in window) ||
		document.hidden ||
		typeof window.requestIdleCallback !== "function"
	) {
		return;
	}
	const now = performance.now();
	expiresAt ??= Math.max(now, nextAt) + MAX_DEFER_MS;
	quietAt = now + SETTLE_MS;
	arm();
}

function arm(): void {
	if (running || timer !== undefined || idle !== undefined) return;
	if (expiresAt === undefined) return;
	const earliest = Math.max(quietAt, nextAt);
	if (document.hidden || earliest >= expiresAt) {
		cancelReclaim();
		return;
	}
	timer = window.setTimeout(
		() => {
			timer = undefined;
			if (expiresAt === undefined) return;
			const now = performance.now();
			if (document.hidden || now >= expiresAt) {
				cancelReclaim();
			} else if (now < Math.max(quietAt, nextAt)) {
				arm();
			} else {
				idle = window.requestIdleCallback(onIdle, { timeout: IDLE_TIMEOUT_MS });
			}
		},
		Math.max(0, earliest - performance.now()),
	);
}

function onIdle(deadline: IdleDeadline): void {
	idle = undefined;
	if (expiresAt === undefined) return;
	const now = performance.now();
	if (document.hidden || now >= expiresAt) {
		cancelReclaim();
	} else if (
		deadline.didTimeout ||
		deadline.timeRemaining() < MIN_IDLE_BUDGET_MS
	) {
		// A timeout is a chance to reconsider, not permission to force GC.
		quietAt = Math.max(quietAt, now + SETTLE_MS);
		arm();
	} else if (now < Math.max(quietAt, nextAt)) {
		arm();
	} else {
		void run();
	}
}

async function run(): Promise<void> {
	expiresAt = undefined;
	running = true;
	nextAt = performance.now() + MIN_GAP_MS;
	try {
		off = !(await invoke<boolean>("reclaim_wbmem"));
	} catch (error) {
		// A transient renderer failure should not disable reclaim for the
		// lifetime of the WebView. Retry only after a new disposal and backoff.
		nextAt = performance.now() + FAILURE_GAP_MS;
		cancelReclaim();
		if (!warned) {
			warned = true;
			// biome-ignore lint/suspicious/noConsole: Report a runtime failure once per WebView.
			console.warn("WebView memory reclamation failed:", error);
		}
	} finally {
		running = false;
		if (off) cancelReclaim();
		else arm();
	}
}
