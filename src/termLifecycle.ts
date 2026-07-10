import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";

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

export const defaultLifecyclePrefs: ParttyLifecyclePrefs = {
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
export function mergeLifecyclePrefs(raw: Record<string, unknown> | undefined): ParttyLifecyclePrefs {
  if (!raw) return { ...defaultLifecyclePrefs };
  return {
    webgl_shed_on_hide: b(raw.webgl_shed_on_hide, defaultLifecyclePrefs.webgl_shed_on_hide),
    discard_buffer_on_hide: b(raw.discard_buffer_on_hide, defaultLifecyclePrefs.discard_buffer_on_hide),
    scrollback_lines: Math.max(0, Math.min(50_000, Math.floor(n(raw.scrollback_lines, defaultLifecyclePrefs.scrollback_lines)))),
    snapshot_max_lines: Math.max(50, Math.min(50_000, Math.floor(n(raw.snapshot_max_lines, defaultLifecyclePrefs.snapshot_max_lines)))),
    preload_pty_on_startup: b(raw.preload_pty_on_startup, defaultLifecyclePrefs.preload_pty_on_startup),
    preload_webgl_on_startup: b(raw.preload_webgl_on_startup, defaultLifecyclePrefs.preload_webgl_on_startup),
    defer_window_show_until_prepared: b(
      raw.defer_window_show_until_prepared,
      defaultLifecyclePrefs.defer_window_show_until_prepared,
    ),
    destroy_webview_on_hide: b(raw.destroy_webview_on_hide, defaultLifecyclePrefs.destroy_webview_on_hide),
    focus_follows_cursor: b(raw.focus_follows_cursor, defaultLifecyclePrefs.focus_follows_cursor),
  };
}

/** Plain-text snapshot of the buffer (last up to `maxLines` logical lines). */
export function capturePlainBuffer(term: Terminal, maxLines: number): string {
  const cap = Math.max(1, Math.floor(maxLines));
  const buf = term.buffer.active;
  const n = buf.length;
  const start = Math.max(0, n - cap);
  const lines: string[] = [];
  for (let i = start; i < n; i++) {
    lines.push(buf.getLine(i)?.translateToString(false) ?? "");
  }
  return lines.join("\r\n");
}

/**
 * First line index with visible content in the normal-buffer scrollback
 * (lines above `baseY`). Leading blank rows are unused capacity, not history.
 */
export function firstContentScrollbackLine(term: Terminal): number {
  const buf = term.buffer.normal;
  const limit = Math.min(Math.max(0, buf.baseY), buf.length);
  let y = 0;
  while (y < limit) {
    const text = buf.getLine(y)?.translateToString(true) ?? "";
    if (text.trim().length > 0) return y;
    y++;
  }
  return y;
}

export async function createWebglAddon(): Promise<WebglAddon> {
  const { WebglAddon } = await import("@xterm/addon-webgl");
  return new WebglAddon();
}
