import { invoke } from "@tauri-apps/api/core";

/**
 * Tauri deserializes command args with camelCase keys; Rust `session_id` → `sessionId`.
 *
 * All PTY commands are keyed by the terminal's stable internal `sessionId`
 * (never the positional pane id), so the session→process association is
 * deterministic across pane moves, tab re-keys, and layout changes.
 */

/**
 * Spawn or re-attach a session. Every call (including resummon) also posts a
 * fresh shared-memory output ring for the session (`src/pty/sharedRing.ts`).
 */
export function ptyEnsure(
	sessionId: string,
	cols: number,
	rows: number,
	initialCwd?: string | null,
	shell?: string | null,
	profileId?: string | null,
	startupCommand?: string | null,
): Promise<void> {
	return invoke("pty_ensure", {
		sessionId,
		cols,
		rows,
		initialCwd: initialCwd || null,
		shell: shell || null,
		profileId: profileId || null,
		startupCommand: startupCommand || null,
	});
}

export type PtyResizeEntry = {
	sessionId: string;
	cols: number;
	rows: number;
};

export function ptyResizeBatch(
	items: ReadonlyArray<PtyResizeEntry>,
): Promise<void> {
	if (items.length === 0) return Promise.resolve();
	return invoke("pty_resize_batch", { items });
}

export function ptyWrite(sessionId: string, data: string): Promise<void> {
	return invoke("pty_write", { sessionId, data });
}

/** Raw replay buffer bytes for a session (empty `ArrayBuffer` when none). */
export function ptyReplaySnapshot(sessionId: string): Promise<ArrayBuffer> {
	return invoke<ArrayBuffer>("pty_replay_snapshot", { sessionId });
}

export function ptyKillPane(sessionId: string): Promise<void> {
	return invoke("pty_kill_pane", { sessionId });
}

export function ptyAckExit(sessionId: string): Promise<void> {
	return invoke("pty_ack_exit", { sessionId });
}

export function ptyFocusPane(sessionId: string): Promise<void> {
	return invoke("pty_focus_pane", { sessionId });
}

/** Structural subset of a pane terminal needed for stable-session ownership. */
export type PtySessionOwner = {
	readonly sessionId: string;
	readonly paneId: string;
};

/**
 * A pane owns its PTY only while the stable session id still resolves to the
 * exact terminal instance. Pane ids are positional and can be reused, so they
 * must never be used to decide whether late startup work is still wanted.
 */
export function isPtyOwner(
	paneBySessionId: ReadonlyMap<string, PtySessionOwner>,
	pt: PtySessionOwner,
): boolean {
	return paneBySessionId.get(pt.sessionId) === pt;
}
export type PtyStartupDims = { cols: number; rows: number };

export type PtyStartupOutcome = "ensured" | "aborted" | "failed";

export type PtyStartupOptions = {
	sessionId: string;
	/** Consult the stable session→terminal map before/after every await. */
	isOwned: () => boolean;
	fit: () => void;
	readDims: () => PtyStartupDims | null;
	waitFrame: () => Promise<void>;
	sleep: (ms: number) => Promise<void>;
	ensure: (dims: PtyStartupDims) => Promise<void>;
	replay: () => Promise<void>;
	fallbackDims: PtyStartupDims;
	clampDims: (dims: PtyStartupDims) => PtyStartupDims;
	onEnsured: (dims: PtyStartupDims) => void;
	onFailure: (error: unknown) => void;
	onAttemptFailure?: (error: unknown) => void;
	/** Best-effort kill of a late successful ensure that lost ownership. */
	kill: (sessionId: string) => Promise<void>;
};

const NON_RETRYABLE_SHELL_ERROR_RE =
	/not found|cannot find|does not exist|no such file|access denied|permission denied|invalid/i;
const PTY_ENSURE_MAX_ATTEMPTS = 4;
const PTY_ENSURE_RETRY_MS = 55;

async function killLostPty(
	sessionId: string,
	kill: (sessionId: string) => Promise<void>,
): Promise<void> {
	try {
		await kill(sessionId);
	} catch {
		/* the pane is already gone; nothing useful to report */
	}
}

/**
 * Run PTY startup for one terminal and abandon it as soon as that terminal
 * loses ownership. A `pty_ensure` that was already in flight may still finish
 * successfully after disposal; in that case its stable session is explicitly
 * killed so the backend process cannot outlive the pane.
 *
 * Retries, fitting, replay and terminal failure output all happen only while
 * ownership is retained. A re-key/transfer keeps the same terminal instance
 * and session, so it is not treated as disposal.
 */
export async function runPtyStartup(
	opts: PtyStartupOptions,
): Promise<PtyStartupOutcome> {
	const {
		sessionId,
		isOwned,
		fit,
		readDims,
		waitFrame,
		sleep,
		ensure,
		replay,
		fallbackDims,
		clampDims,
		onEnsured,
		onFailure,
		onAttemptFailure,
		kill,
	} = opts;
	if (!isOwned()) return "aborted";

	fit();
	let raw = readDims();
	for (let frame = 0; !raw && frame < 2; frame++) {
		// biome-ignore lint/performance/noAwaitInLoops: layout waits are sequential.
		await waitFrame();
		if (!isOwned()) return "aborted";
		fit();
		raw = readDims();
	}
	let safe = clampDims(raw ?? fallbackDims);
	let lastErr: unknown;

	for (let attempt = 0; attempt < PTY_ENSURE_MAX_ATTEMPTS; attempt++) {
		if (attempt > 0) {
			// biome-ignore lint/performance/noAwaitInLoops: retries must be sequential.
			await sleep(PTY_ENSURE_RETRY_MS * attempt);
			if (!isOwned()) return "aborted";
			fit();
			raw = readDims() ?? raw ?? fallbackDims;
			safe = clampDims(raw);
		}
		if (!isOwned()) return "aborted";
		try {
			await ensure(safe);
		} catch (e) {
			if (!isOwned()) return "aborted";
			lastErr = e;
			onAttemptFailure?.(e);
			if (NON_RETRYABLE_SHELL_ERROR_RE.test(String(e).toLowerCase())) {
				break;
			}
			continue;
		}
		// The ensure may have completed after the pane was disposed. Kill the
		// late process before doing any replay or success bookkeeping.
		if (!isOwned()) {
			await killLostPty(sessionId, kill);
			return "aborted";
		}
		await replay();
		if (!isOwned()) {
			await killLostPty(sessionId, kill);
			return "aborted";
		}
		onEnsured(safe);
		return "ensured";
	}
	if (!isOwned()) return "aborted";
	onFailure(lastErr);
	return "failed";
}
