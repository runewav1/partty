import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import {
	ensurePaneSerialize,
	type PaneHost,
	type PaneTerminal,
} from "./paneHost";
import { serializeReplayMouseEncoding } from "./replayModes";
import {
	firstContentScrollbackLine,
	type ParttyLifecyclePrefs,
} from "./termLifecycle";

type Hosts = Iterable<Pick<PaneHost, "forEachPane">>;
type StashPrefs = Pick<
	ParttyLifecyclePrefs,
	"destroy_webview_on_hide" | "discard_buffer_on_hide"
>;
type StashedPaneBuffer = { data: string; cols: number; rows: number };

function warn(message: string, error: unknown): void {
	// biome-ignore lint/suspicious/noConsole: recoverable lifecycle failures need a diagnostic.
	console.warn(message, error);
}

async function serializePane(pt: PaneTerminal): Promise<string> {
	const { term } = pt;
	const serialize = await ensurePaneSerialize(pt);
	const start = firstContentScrollbackLine(term);
	const end = Math.max(0, term.buffer.normal.length - 1);
	const payload: StashedPaneBuffer = {
		data:
			serialize.serialize({ range: { start, end } }) +
			serializeReplayMouseEncoding(term),
		cols: term.cols,
		rows: term.rows,
	};
	return JSON.stringify(payload);
}

export async function stashScrollbackForHide(
	hosts: Hosts,
	prefs: StashPrefs,
): Promise<void> {
	if (!prefs.destroy_webview_on_hide) return;

	const buffers: Record<string, string> = {};
	const jobs: Promise<void>[] = [];
	for (const host of hosts) {
		host.forEachPane((id, pt) => {
			if (prefs.discard_buffer_on_hide) {
				try {
					pt.term.reset();
				} catch {
					/* still signal that the WebView can be destroyed */
				}
				return;
			}
			jobs.push(
				serializePane(pt)
					.then((data) => {
						buffers[id] = data;
					})
					.catch((e) => warn(`serialize pane ${id}`, e)),
			);
		});
	}
	await Promise.all(jobs);
	await invoke("stash_terminal_buffers", { buffers }).catch((e) =>
		warn("stash_terminal_buffers", e),
	);
}

/** Resolve after xterm has parsed the write, not just queued it. */
export function writeTerminalSerialized(
	term: Terminal,
	data: string | Uint8Array,
): Promise<void> {
	return new Promise((resolve) => term.write(data, () => resolve()));
}

async function restorePane(term: Terminal, raw: string): Promise<void> {
	let data = raw;
	if (raw.startsWith("{")) {
		const parsed = JSON.parse(raw) as StashedPaneBuffer;
		if (typeof parsed.data === "string") {
			data = parsed.data;
			const cols = Number(parsed.cols) || 0;
			const rows = Number(parsed.rows) || 0;
			if (cols >= 2 && rows >= 1) term.resize(cols, rows);
		}
	}
	await writeTerminalSerialized(term, data);
}

export async function restoreScrollbackIfNeeded(
	hosts: Hosts,
	discard: boolean,
	fallback: boolean,
	onRestored: (id: string) => void,
): Promise<void> {
	const needsRestore = await invoke<boolean>(
		"take_webview_destroyed_for_hide",
	).catch((e) => {
		warn("take_webview_destroyed_for_hide", e);
		return fallback;
	});
	if (!needsRestore) return;
	const buffers = await invoke<Record<string, string> | null>(
		"take_terminal_buffers",
	).catch(() => null);
	if (discard || !buffers || Object.keys(buffers).length === 0) return;

	const writes: Promise<void>[] = [];
	for (const host of hosts) {
		host.forEachPane((id, pt) => {
			const raw = buffers[id];
			if (!raw) return;
			writes.push(
				restorePane(pt.term, raw)
					.then(() => onRestored(id))
					.catch((e) => warn(`restore scrollback for ${id}`, e)),
			);
		});
	}
	await Promise.all(writes);
}
