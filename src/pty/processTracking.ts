/** Tracked foreground command in a pane (shell-integration observed). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal control characters from shell-integration payloads.
const CONTROL_CHARACTERS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const QUOTED_COMMAND = /^(['"])(.+?)\1/;
const COMMAND_TOKEN = /^[^\s|&;<>]+/;
const WHITESPACE = /\s+/;
const HAS_WHITESPACE = /\s/;
const PATH_SEPARATOR = /[\\/]/;

export type ActiveProcessEntry = {
	command: string;
	startedAt: number;
	cwd: string;
	/** Shell emitted OSC 633;C — the command is executing. */
	execStarted: boolean;
};

function normalizeCommandLine(command: string): string {
	return command.replace(CONTROL_CHARACTERS, "").trim();
}

function firstCommandWord(command: string): string {
	const trimmed = normalizeCommandLine(command);
	if (!trimmed) return "";
	const quoted = trimmed.match(QUOTED_COMMAND);
	if (quoted) return quoted[2] ?? trimmed;
	const token = trimmed.match(COMMAND_TOKEN);
	return token?.[0] ?? trimmed.split(WHITESPACE)[0] ?? trimmed;
}

/**
 * Prefer the fuller user-typed line when multiple OSC 633;E payloads arrive
 * for the same command (e.g. multi-line pwsh buffers) — never shrink it.
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
	const curTokens = cur.split(WHITESPACE);
	if (curTokens.some((t) => t.toLowerCase() === incLower)) return cur;
	if (inc.length < cur.length) return cur;

	return inc.length >= cur.length ? inc : cur;
}

/** Label for palette / notifications: full command when sane, else executable name. */
export function displayProcessCommand(command: string): string {
	const normalized = normalizeCommandLine(command);
	if (!normalized) return "";
	if (HAS_WHITESPACE.test(normalized)) return normalized;
	return normalized;
}

/** Per-component truncation thresholds for process-completion notifications. */
export const NOTIF_COMMAND_MAX = 50;
export const NOTIF_PANE_MAX = 40;
export const NOTIF_CWD_MAX = 60;
export const NOTIF_DETAIL_MAX = 120;

/** Truncate a single line to `max` chars, appending an ellipsis. */
export function truncateEnd(text: string, max: number): string {
	if (text.length <= max) return text;
	if (max <= 1) return "\u2026";
	return text.slice(0, max - 1) + "\u2026";
}

/**
 * Path-aware truncation that keeps trailing components and only cuts the
 * head, so the meaningful tail (leaf directory / file) survives.
 */
export function truncatePathTail(path: string, max: number): string {
	if (path.length <= max) return path;
	const parts = path.split(PATH_SEPARATOR).filter(Boolean);
	if (parts.length < 2) return truncateEnd(path, max);
	let tail = parts[parts.length - 1];
	for (let i = parts.length - 2; i >= 0; i--) {
		const candidate = `${parts[i]}/${tail}`;
		if (candidate.length + 2 > max) break; // +2 for the "…/" head
		tail = candidate;
	}
	const kept = `\u2026/${tail}`;
	return kept.length <= max ? kept : `\u2026/${truncateEnd(tail, max - 2)}`;
}

export function createActiveProcessEntry(
	command: string,
	cwd: string,
): ActiveProcessEntry {
	return {
		command: normalizeCommandLine(command),
		startedAt: Date.now(),
		cwd,
		execStarted: false,
	};
}

export function applyShellCommandLine(
	entry: ActiveProcessEntry,
	text: string,
): void {
	if (!text) return;
	entry.command = mergeProcessCommand(entry.command, text);
}

export function markProcessExecStart(
	entry: ActiveProcessEntry,
	at = Date.now(),
): void {
	entry.execStarted = true;
	entry.startedAt = at;
}

export function processDurationMs(
	entry: ActiveProcessEntry,
	endedAt: number,
): number {
	return Math.max(0, endedAt - entry.startedAt);
}
