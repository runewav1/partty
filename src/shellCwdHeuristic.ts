/**
 * Best-effort cwd hints from plain shell output (complements OSC 7 and backend pty_shell_cwd).
 * Uses a rolling tail per pane so paths split across PTY chunks still match.
 */

import { normalizeFsPathKey } from "./oscCwd";

const ANSI_STRIP = /\x1b\[[\d;?]*[ -/]*[@-~]/g;

const ROLLING_MAX = 16384;

/** Looks like `C:\...` or `C:/...` (minimal validation). */
const WIN_ABS = /\b([A-Za-z]:[\\/][^\s\r\n<>|:*"?]*)/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_STRIP, "");
}

function normalizePath(p: string): string {
  return p.trim().replace(/[/\\]+$/, "").replace(/\//g, "\\");
}

/** Strip common cmd.exe prompt prefixes so the current directory line is visible. */
function stripLeadingCmdPrompt(line: string): string {
  let t = line.trim();
  t = t.replace(/^\[[^\]]*]\s*/, "");
  t = t.replace(/^(?:[A-Za-z]:\\[^>\r\n]*)?>\s*/, "");
  return t.trim();
}

/**
 * Scan accumulated PTY text for a plausible current directory.
 * `prevHint` is last known cwd for this pane (avoids noise).
 */
export function extractCwdHintFromOutput(text: string, prevLive: string | null): string | null {
  const plain = stripAnsi(text);
  const lines = plain.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = stripLeadingCmdPrompt(rawLine);
    const t = line.trim();
    if (!t) continue;

    const pathCol = /^Path\s*:\s*(.+)$/i.exec(t);
    if (pathCol) {
      const p = normalizePath(pathCol[1]!);
      if (looksLikeWinAbs(p)) return p;
    }

    const solo = normalizePath(t);
    if (looksLikeWinAbs(solo) && solo.length >= 4) {
      if (normalizeFsPathKey(solo) !== normalizeFsPathKey(prevLive ?? "")) {
        return solo;
      }
    }
  }

  let best: string | null = null;
  let bestLen = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(WIN_ABS.source, "g");
  while ((m = re.exec(plain)) !== null) {
    const p = normalizePath(m[1]!);
    if (looksLikeWinAbs(p) && p.length > bestLen) {
      bestLen = p.length;
      best = p;
    }
  }
  if (best && normalizeFsPathKey(best) !== normalizeFsPathKey(prevLive ?? "")) {
    return best;
  }
  return null;
}

function looksLikeWinAbs(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) && !/[<>|*"?]/.test(p);
}

/** Append PTY output to a rolling buffer and return an updated cwd hint if any. */
export function appendCwdRollingTail(
  prevTail: string,
  chunk: string,
  prevLive: string | null,
): { tail: string; cwd: string | null } {
  const next = (prevTail + stripAnsi(chunk)).slice(-ROLLING_MAX);
  const cwd = extractCwdHintFromOutput(next, prevLive);
  return { tail: next, cwd };
}
