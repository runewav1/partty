// Coalesce WebView memory reclamation triggered by terminal lifecycle changes.
// Requests are debounced so the change and its layout/render work settle first,
// then rate-limited so a forced GC never becomes a periodic loop. The pass itself
// runs at an idle moment because the renderer GC is stop-the-world and shares a
// thread with xterm parsing, input and rendering.
const SETTLE_MS = 2_000;
const MIN_GAP_MS = 10_000;
const IDLE_TIMEOUT_MS = 1_500;
let timer: number | undefined;
let lastAt = Number.NEGATIVE_INFINITY;
let queued = false;
let running = false;
let off = false;

/** Ask for one reclamation pass once the current change has settled. */
export function scheduleReclaim(): void {
	if (
		off ||
		typeof window === "undefined" ||
		!("__TAURI_INTERNALS__" in window)
	) {
		return;
	}
	queued = true;
	if (!running) arm();
}

function arm(): void {
	if (timer !== undefined) window.clearTimeout(timer);
	const wait = Math.max(SETTLE_MS, MIN_GAP_MS - (performance.now() - lastAt));
	timer = window.setTimeout(() => {
		timer = undefined;
		// Commit this pass and reserve; later triggers only queue a follow-up.
		queued = false;
		running = true;
		whenIdle(() => void run());
	}, wait);
}

// Prefer an idle moment so the forced GC does not land mid-keystroke. The timeout
// keeps it bounded when the page never reports idle.
function whenIdle(fn: () => void): void {
	if (typeof window.requestIdleCallback === "function") {
		window.requestIdleCallback(() => fn(), { timeout: IDLE_TIMEOUT_MS });
	} else {
		fn();
	}
}

async function run(): Promise<void> {
	lastAt = performance.now();
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		// The backend returns false where there is no implementation; a rejection
		// means the runtime refused the hints. Stop asking either way.
		off = !(await invoke<boolean>("reclaim_wbmem"));
	} catch (error) {
		off = true;
		// biome-ignore lint/suspicious/noConsole: Report a capability failure once per webview.
		console.warn("WebView memory reclamation unavailable:", error);
	} finally {
		running = false;
		if (queued && !off) arm();
	}
}
