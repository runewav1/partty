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

/** Keystroke fallback when shell OSC integration is unavailable. */
export function needsKeystrokeProcessTracking(
  notificationsEnabled: boolean,
  extensionSubscriberCount: number,
): boolean {
  return notificationsEnabled || extensionSubscriberCount > 0;
}

export type KeystrokeProcessObserver = {
  buffers: Map<string, string>;
  onCommandEnter: (paneId: string, command: string) => void;
};

/** Parse raw PTY input for Enter-observed command starts (non-OSC shells). */
export function observeKeystrokeProcessInput(
  observer: KeystrokeProcessObserver,
  paneId: string,
  data: string,
): void {
  let buf = observer.buffers.get(paneId) ?? "";
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    const code = ch.charCodeAt(0);

    if (ch === "\x1b") {
      if (data[i + 1] === "]") {
        const end = data.indexOf("\x07", i + 2);
        const st = data.indexOf("\x1b\\", i + 2);
        const n = end === -1 ? st : st === -1 ? end : Math.min(end, st);
        i = n === -1 ? data.length : n + (data[n] === "\x1b" ? 2 : 1);
        continue;
      }
      if (data[i + 1] === "[") {
        let j = i + 2;
        while (j < data.length && data.charCodeAt(j) < 0x40) j++;
        i = j < data.length ? j + 1 : data.length;
        continue;
      }
      if (
        data[i + 1] === "P" ||
        data[i + 1] === "_" ||
        data[i + 1] === "^" ||
        data[i + 1] === "X"
      ) {
        const st = data.indexOf("\x1b\\", i + 2);
        i = st === -1 ? data.length : st + 2;
        continue;
      }
      i += 2;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      const cmd = normalizeCommandLine(buf);
      if (cmd) observer.onCommandEnter(paneId, cmd);
      buf = "";
      i++;
      continue;
    }

    if (ch === "\b" || code === 0x7f) {
      buf = buf.slice(0, -1);
      i++;
      continue;
    }

    if (code === 0x17 || ch === "\x1b\x7f" || ch === "\x1b\x08") {
      buf = buf.replace(/\S+\s*$/, "").trimEnd();
      i++;
      continue;
    }

    if (code === 0x15) {
      buf = "";
      i++;
      continue;
    }

    if ((code >= 0x20 && code !== 0x7f) || code === 0x09) {
      buf += ch;
      i++;
      continue;
    }

    i++;
  }
  observer.buffers.set(paneId, buf);
}
