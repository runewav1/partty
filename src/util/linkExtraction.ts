import type { Terminal } from "@xterm/xterm";

import { expandRelativePath } from "./paths";

/**
 * Extract URLs, absolute paths, and relative path fragments from a terminal
 * line at a given column — the ctrl+click / ctrl+alt+click tokenizers.
 * All functions are pure over their inputs; callers wire pane cwd + shell style.
 */

export function getTerminalClickCell(
  term: Terminal,
  host: HTMLElement,
  ev: MouseEvent,
): { col: number; row: number } | null {
  const screen = host.querySelector(".xterm-screen") as HTMLElement | null;
  if (!screen) return null;
  const rect = screen.getBoundingClientRect();
  if (
    ev.clientX < rect.left ||
    ev.clientX > rect.right ||
    ev.clientY < rect.top ||
    ev.clientY > rect.bottom
  ) {
    return null;
  }
  const cols = Math.max(1, term.cols);
  const rows = Math.max(1, term.rows);
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  if (
    !Number.isFinite(cellW) ||
    !Number.isFinite(cellH) ||
    cellW <= 0 ||
    cellH <= 0
  )
    return null;
  const col = Math.max(
    0,
    Math.min(cols - 1, Math.floor((ev.clientX - rect.left) / cellW)),
  );
  const row = Math.max(
    0,
    Math.min(rows - 1, Math.floor((ev.clientY - rect.top) / cellH)),
  );
  return { col, row };
}

export function normalizeExternalUrl(value: string): string | null {
  const raw = value.trim().replace(/[),.;:!?]+$/g, "");
  if (!raw) return null;

  const hasHttpScheme = /^https?:\/\//i.test(raw);
  const isWww = /^www\./i.test(raw);
  // Keep this allowlist aligned with the native open_external_url command.
  const isLocalhost = /^localhost:\d+(?:[^\s<>"'`]*)?$/i.test(raw);
  const isLoopback = /^(?:127\.0\.0\.1|\[::1\]|::1):\d+(?:[^\s<>"'`]*)?$/i.test(raw);
  if (!(hasHttpScheme || isWww || isLocalhost || isLoopback)) return null;

  const normalized = hasHttpScheme ? raw : `https://${raw}`;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function extractUrlAtColumn(line: string, column: number): string | null {
  const re =
    /(?:https?:\/\/|www\.)[^\s<>"'`]+|(?:localhost|127\.0\.0\.1):\d+[^\s<>"'`]*|\[::1\]:\d+[^\s<>"'`]*|::1:\d+[^\s<>"'`]*/gi;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (column < start || column >= end) continue;
    return normalizeExternalUrl(m[0]);
  }
  return null;
}

/** Absolute / home-anchored paths only — avoids `foo/bar` false positives. */
export function extractPathAtColumn(line: string, column: number): string | null {
  const re =
    /(?:"([^"\n]+)"|'([^'\n]+)'|(?:\\\\|\/\/)[^\s<>"'`]+|[A-Za-z]:[\\/][^\s<>"'`]+|~\/[^\s<>"'`]+|\/(?:home|Users|usr|etc|var|tmp|opt|mnt|root|dev|proc|sys|bin|lib|sbin|boot|media|run|snap)(?:\/[^\s<>"'`]*)?)/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (column < start || column >= end) continue;
    const quoted = m[1] ?? m[2];
    let raw = (quoted ?? m[0]).replace(/[),.;:!?\]]+$/g, "");
    if (!raw) continue;
    // Quoted match must still look like a path.
    if (quoted) {
      const looksAbsolute =
        /^[A-Za-z]:[\\/]/.test(raw) ||
        /^\\\\|^\/\//.test(raw) ||
        raw.startsWith("~/") ||
        /^\/(?:home|Users|usr|etc|var|tmp|opt|mnt|root|dev|proc|sys|bin|lib|sbin|boot|media|run|snap)(?:\/|$)/.test(
          raw,
        );
      if (!looksAbsolute) continue;
    }
    return raw;
  }
  return null;
}

/** Unquoted relative fragments containing a separator (`src/foo.rs`, `../x`), expanded against the pane cwd. */
export function extractRelativePathAtColumn(
  line: string,
  column: number,
  cwd: string | null,
): string | null {
  if (!cwd) return null;
  const re = /\S+/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (column < start || column >= end) continue;
    let raw = m[0].replace(/[),.;:!?\]]+$/g, "");
    if (!raw) continue;
    if (!isRelativePathCandidate(raw)) continue;
    return expandRelativePath(raw, cwd);
  }
  return null;
}

function isRelativePathCandidate(tok: string): boolean {
  if (/^[\\/]/.test(tok)) return false; // absolute / UNC — handled elsewhere
  if (/^[A-Za-z]:[\\/]/.test(tok)) return false; // drive absolute
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(tok)) return false; // URL
  if (!tok.includes("/") && !tok.includes("\\")) return false; // needs a separator
  if (/^\.{1,2}$/.test(tok)) return false;
  return true;
}