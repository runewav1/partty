/** Tracked foreground command in a pane (shell or Enter-observed). */
export type ActiveProcessEntry = {
  command: string;
  startedAt: number;
  cwd: string;
  /** Shell emitted OSC 633;C — the command is executing. */
  execStarted: boolean;
  /** Command line was refined by OSC 633;E at least once. */
  shellCommand: boolean;
};

export function normalizeCommandLine(command: string): string {
  return command.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
}

export function firstCommandWord(command: string): string {
  const trimmed = normalizeCommandLine(command);
  if (!trimmed) return "";
  const quoted = trimmed.match(/^(['"])(.+?)\1/);
  if (quoted) return quoted[2] ?? trimmed;
  const token = trimmed.match(/^[^\s|&;<>]+/);
  return token?.[0] ?? trimmed.split(/\s+/)[0] ?? trimmed;
}

/**
 * Prefer the full user-typed line. Shell hooks (esp. bash DEBUG) may emit
 * later fragments — never replace a longer line with a substring.
 */
export function mergeProcessCommand(current: string, incoming: string): string {
  const cur = normalizeCommandLine(current);
  const inc = normalizeCommandLine(incoming);
  if (!inc) return cur;
  if (!cur) return inc;
  if (inc === cur) return cur;

  const curLower = cur.toLowerCase();
  const incLower = inc.toLowerCase();

  if (curLower.includes(incLower) && inc.length < cur.length) return cur;
  if (incLower.includes(curLower) && inc.length > cur.length) return inc;

  const curWord = firstCommandWord(cur).toLowerCase();
  const incWord = firstCommandWord(inc).toLowerCase();
  if (curWord && incWord === curWord) {
    return inc.length >= cur.length ? inc : cur;
  }

  // Bare fragment that appears as a token inside the current line.
  const curTokens = cur.split(/\s+/);
  if (curTokens.some((t) => t.toLowerCase() === incLower)) return cur;
  if (inc.length < cur.length) return cur;

  return inc.length >= cur.length ? inc : cur;
}

/** Label for palette / notifications: full command when sane, else executable name. */
export function displayProcessCommand(command: string): string {
  const normalized = normalizeCommandLine(command);
  if (!normalized) return "";
  if (/\s/.test(normalized)) return normalized;
  return normalized;
}

export function createActiveProcessEntry(command: string, cwd: string): ActiveProcessEntry {
  return {
    command: normalizeCommandLine(command),
    startedAt: Date.now(),
    cwd,
    execStarted: false,
    shellCommand: false,
  };
}

export function applyShellCommandLine(entry: ActiveProcessEntry, text: string): void {
  if (!text) return;
  entry.shellCommand = true;
  entry.command = mergeProcessCommand(entry.command, text);
}

export function markProcessExecStart(entry: ActiveProcessEntry, at = Date.now()): void {
  entry.execStarted = true;
  entry.startedAt = at;
}

/** End on prompt-start when Enter-only tracking, or when exec started but done OSC was lost. */
export function shouldEndOnPromptStart(entry: ActiveProcessEntry): boolean {
  if (entry.execStarted) return true;
  return !entry.shellCommand;
}

export function processDurationMs(entry: ActiveProcessEntry, endedAt: number): number {
  return Math.max(0, endedAt - entry.startedAt);
}
