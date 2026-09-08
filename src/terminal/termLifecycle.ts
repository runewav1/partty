import type { WebglAddon } from "@xterm/addon-webgl";
import type { WebgpuAddon } from "@partty/addon-webgpu";
import type { Terminal } from "@xterm/xterm";

/** Subset of Rust `Prefs` used by the webview lifecycle (snake_case from JSON). */
export type ParttyLifecyclePrefs = {
	webgl_shed_on_hide: boolean;
	discard_buffer_on_hide: boolean;
	scrollback_lines: number;
	snapshot_max_lines: number;
	preload_pty_on_startup: boolean;
	preload_webgl_on_startup: boolean;
	defer_window_show_until_prepared: boolean;
	/** Tear down WebView2 after hide (Rust recreates window on next show). */
	destroy_webview_on_hide: boolean;
	/** When true, moving the pointer between panes moves focus (split view). */
	focus_follows_cursor: boolean;
};

const defaultLifecyclePrefs: ParttyLifecyclePrefs = {
	webgl_shed_on_hide: true,
	discard_buffer_on_hide: false,
	scrollback_lines: 1000,
	snapshot_max_lines: 2500,
	preload_pty_on_startup: true,
	preload_webgl_on_startup: true,
	defer_window_show_until_prepared: true,
	destroy_webview_on_hide: true,
	focus_follows_cursor: false,
};

function n(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function b(v: unknown, fallback: boolean): boolean {
	return typeof v === "boolean" ? v : fallback;
}

/** Merge Rust `prefs` JSON (may include unrelated keys) into lifecycle options. */
export function mergeLifecyclePrefs(
	raw: Record<string, unknown> | undefined,
): ParttyLifecyclePrefs {
	if (!raw) return { ...defaultLifecyclePrefs };
	return {
		webgl_shed_on_hide: b(
			raw.webgl_shed_on_hide,
			defaultLifecyclePrefs.webgl_shed_on_hide,
		),
		discard_buffer_on_hide: b(
			raw.discard_buffer_on_hide,
			defaultLifecyclePrefs.discard_buffer_on_hide,
		),
		scrollback_lines: Math.max(
			0,
			Math.min(
				50_000,
				Math.floor(
					n(raw.scrollback_lines, defaultLifecyclePrefs.scrollback_lines),
				),
			),
		),
		snapshot_max_lines: Math.max(
			50,
			Math.min(
				50_000,
				Math.floor(
					n(raw.snapshot_max_lines, defaultLifecyclePrefs.snapshot_max_lines),
				),
			),
		),
		preload_pty_on_startup: b(
			raw.preload_pty_on_startup,
			defaultLifecyclePrefs.preload_pty_on_startup,
		),
		preload_webgl_on_startup: b(
			raw.preload_webgl_on_startup,
			defaultLifecyclePrefs.preload_webgl_on_startup,
		),
		defer_window_show_until_prepared: b(
			raw.defer_window_show_until_prepared,
			defaultLifecyclePrefs.defer_window_show_until_prepared,
		),
		destroy_webview_on_hide: b(
			raw.destroy_webview_on_hide,
			defaultLifecyclePrefs.destroy_webview_on_hide,
		),
		focus_follows_cursor: b(
			raw.focus_follows_cursor,
			defaultLifecyclePrefs.focus_follows_cursor,
		),
	};
}

/** First non-blank scrollback line (leading empty rows are unused capacity). */
export function firstContentScrollbackLine(term: Terminal): number {
	const buf = term.buffer.normal;
	const limit = Math.min(Math.max(0, buf.baseY), buf.length);
	for (let y = 0; y < limit; y++) {
		const text = buf.getLine(y)?.translateToString(true) ?? "";
		if (text.trim().length > 0) return y;
	}
	return limit;
}

export type TerminalRendererAddon = WebglAddon | WebgpuAddon;

export type RendererKind = "webgl" | "webgpu" | "dom";

/**
 * Inspect the renderer actually installed by RenderService, not the addon that
 * created it. WebGL and WebGPU both use GpuRenderer, so the backend object is
 * the distinguishing signal (WebglBackend vs WebgpuBackend).
 */
export function activeRendererKind(term: Terminal): RendererKind {
	const renderer = (term as unknown as {
		_core?: {
			_renderService?: {
				_renderer?: {
					value?: { _backend?: { constructor?: { name?: string } } };
				};
			};
		};
	})._core?._renderService?._renderer?.value;
	const name = renderer?._backend?.constructor?.name;
	if (name === "WebgpuBackend") return "webgpu";
	if (name === "WebglBackend") return "webgl";
	return "dom";
}

let webgpuSession: import("@partty/addon-webgpu").WebgpuSession | undefined;
let webgpuFailed = false;

/**
 * Renderer factory for the "enable WebGPU renderer" experimental option. When
 * enabled, one shared WebGPU session (device + pipelines + glyph atlases) is
 * created lazily per webview and a session addon is returned for each pane;
 * WebGL is never constructed while enabled. When disabled, a plain WebGL addon
 * is returned. The caller verifies the installed backend via
 * activeRendererKind() after loadAddon.
 */
export async function createRendererAddon(useWebgpu: boolean): Promise<TerminalRendererAddon> {
	if (useWebgpu) {
		if (webgpuFailed) {
			throw new Error(
				"WebGPU already failed; refusing a silent WebGL fallback while the option is enabled.",
			);
		}
		try {
			if (!webgpuSession) {
				const { WebgpuSession } = await import("@partty/addon-webgpu");
				webgpuSession = await WebgpuSession.create();
				const failed = (error?: unknown) => {
					webgpuFailed = true;
					console.error(
						"WebGPU session failed; panes fall back to DOM, not WebGL.",
						error,
					);
				};
				webgpuSession.onError(failed);
				webgpuSession.onContextLoss(failed);
			}
			return webgpuSession.createAddon();
		} catch (error) {
			webgpuFailed = true;
			throw new Error(
				"WebGPU unavailable; no WebGL fallback while the option is enabled. " +
					(error instanceof Error ? error.message : String(error)),
			);
		}
	}
	const { WebglAddon: WebglAddonConstructor } = await import(
		"@xterm/addon-webgl"
	);
	return new WebglAddonConstructor();
}

/** Release the shared WebGPU session (e.g. when panes are shed on hide). */
export function disposeWebgpuSession(): void {
	webgpuSession?.dispose();
	webgpuSession = undefined;
	webgpuFailed = false;
}
