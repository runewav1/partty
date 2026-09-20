import { invoke } from "@tauri-apps/api/core";
import {
	DEFAULT_BINDS,
	firstMatchingWheelAction,
	keyMatches,
	type ParsedBinding,
	parseBinding,
	type WheelEventLike,
} from "./keybindCore";

type KeybindsSnapshot = { bind: Record<string, string> };

export interface KeybindMatch {
	action: string;
	param: number;
}

export interface KeybindsApi {
	ready: Promise<void>;
	match(e: KeyboardEvent, ...actions: string[]): string | null;
	matchParam(e: KeyboardEvent, ...actions: string[]): KeybindMatch | null;
	/** Match wheel events against wheel-style bindings (`Ctrl+WheelUp`, …). */
	matchWheel(e: WheelEventLike, ...actions: string[]): string | null;
	label(action: string): string;
	all(): Record<string, string>;
	set(action: string, binding: string): Promise<void>;
	reset(): Promise<void>;
}

function digitIndex(e: KeyboardEvent): number {
	const c = e.code;
	if (c?.startsWith("Digit")) {
		const n = Number.parseInt(c.slice(5), 10);
		if (Number.isFinite(n)) return n;
	}
	if (c === "Numpad0") return 0;
	if (c === "Numpad1") return 1;
	if (c === "Numpad2") return 2;
	if (c === "Numpad3") return 3;
	if (c === "Numpad4") return 4;
	if (c === "Numpad5") return 5;
	if (c === "Numpad6") return 6;
	if (c === "Numpad7") return 7;
	if (c === "Numpad8") return 8;
	if (c === "Numpad9") return 9;
	return -1;
}

export function createKeybinds(): KeybindsApi {
	const bind: Record<string, string> = { ...DEFAULT_BINDS };
	let parsed: Record<string, ParsedBinding | null> = {};
	let readyResolve: () => void;
	const readyPromise = new Promise<void>((r) => {
		readyResolve = r;
	});

	function rebuild() {
		parsed = {};
		for (const [action, raw] of Object.entries(bind)) {
			parsed[action] = parseBinding(raw);
		}
	}

	rebuild();

	async function load() {
		try {
			const snap = await invoke<KeybindsSnapshot>("get_keybinds");
			// The native snapshot already merges defaults and removes unbound
			// actions. Retaining frontend defaults here would resurrect unbinds.
			for (const action of Object.keys(bind)) delete bind[action];
			for (const [action, raw] of Object.entries(snap.bind)) {
				bind[action] = raw;
			}
		} catch {
			/* keep defaults */
		}
		rebuild();
		readyResolve();
	}

	load();

	return {
		ready: readyPromise,

		match(e: KeyboardEvent, ...actions: string[]): string | null {
			for (const action of actions) {
				const p = parsed[action];
				if (!p) continue;
				if (
					e.ctrlKey === p.ctrl &&
					e.altKey === p.alt &&
					e.shiftKey === p.shift &&
					e.metaKey === p.meta
				) {
					if (p.param) {
						const n = digitIndex(e);
						if (n >= 0) return action;
					} else if (keyMatches(e.key, p.key)) {
						return action;
					}
				}
			}
			return null;
		},

		matchParam(e: KeyboardEvent, ...actions: string[]): KeybindMatch | null {
			for (const action of actions) {
				const p = parsed[action];
				if (!p) continue;
				if (
					e.ctrlKey === p.ctrl &&
					e.altKey === p.alt &&
					e.shiftKey === p.shift &&
					e.metaKey === p.meta
				) {
					const n = digitIndex(e);
					if (n >= 0 && (p.param || keyMatches(e.key, p.key))) {
						return { action, param: n };
					}
				}
			}
			return null;
		},

		matchWheel(e: WheelEventLike, ...actions: string[]): string | null {
			return firstMatchingWheelAction(parsed, actions, e);
		},

		label(action: string): string {
			return bind[action] ?? action;
		},

		all(): Record<string, string> {
			return { ...bind };
		},

		async set(action: string, binding: string): Promise<void> {
			await invoke("set_keybind", { action, binding });
			bind[action] = binding || "";
			rebuild();
		},

		async reset(): Promise<void> {
			await invoke("reset_keybinds");
			Object.assign(bind, DEFAULT_BINDS);
			for (const key of Object.keys(bind)) {
				if (!(key in DEFAULT_BINDS)) delete bind[key];
			}
			rebuild();
		},
	};
}
