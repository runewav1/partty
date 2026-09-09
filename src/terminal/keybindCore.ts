/**
 * Pure keybind parsing + matching primitives shared by the frontend keybind
 * runtime and Node unit tests. No DOM, no Tauri imports, no side effects: the
 * wheel/zoom behavior (split into hovered-terminal vs all-visible bindings)
 * lives here so it is directly unit-testable.
 */

export type KeyModifierFlags = {
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
};

export type BindingKind = "key" | "param" | "wheel";

export type ParsedBinding = KeyModifierFlags & {
	key: string;
	kind: BindingKind;
	/** True for `{n}` digit placeholders (tab-index actions). */
	param: boolean;
};

/** Wheel pseudo-keys, mirroring the existing `RightClick` special token. */
export const WHEEL = "wheel";
export const WHEEL_UP = "wheelup";
export const WHEEL_DOWN = "wheeldown";
export const WHEEL_KEYS: ReadonlySet<string> = new Set([
	WHEEL,
	WHEEL_UP,
	WHEEL_DOWN,
]);

const MOD_RE = /^(Ctrl|Alt|Shift|Meta)\+/i;

export function parseBinding(raw: string): ParsedBinding | null {
	let s = raw.trim();
	let ctrl = false;
	let alt = false;
	let shift = false;
	let meta = false;
	for (let i = 0; i < 4; i++) {
		const m = s.match(MOD_RE);
		if (!m) break;
		const mod = m[1].toLowerCase();
		if (mod === "ctrl") ctrl = true;
		else if (mod === "alt") alt = true;
		else if (mod === "shift") shift = true;
		else if (mod === "meta") meta = true;
		s = s.slice(m[0].length);
	}
	const key = s;
	if (!key) return null;
	const param = key === "{n}";
	const kind: BindingKind = param
		? "param"
		: WHEEL_KEYS.has(key.toLowerCase())
			? "wheel"
			: "key";
	return { ctrl, alt, shift, meta, key, kind, param };
}

export function normalizeKey(key: string): string {
	if (key.length === 1 && key >= "0" && key <= "9") return key;
	const l = key.toLowerCase();
	if (l === "arrowup") return "arrowup";
	if (l === "arrowdown") return "arrowdown";
	if (l === "arrowleft") return "arrowleft";
	if (l === "arrowright") return "arrowright";
	if (l === "enter") return "enter";
	if (l === "escape") return "escape";
	if (l === "tab") return "tab";
	if (l === "backspace") return "backspace";
	if (l === "delete") return "delete";
	if (l === "f2") return "f2";
	if (l === "/" || l === "slash") return "/";
	if (l === "," || l === "comma") return ",";
	if (l === "\\" || l === "backslash") return "\\";
	if (l === "." || l === "period") return ".";
	if (key.length === 1) return l;
	return l;
}

export function keyMatches(ek: string, bk: string): boolean {
	return normalizeKey(ek) === normalizeKey(bk);
}

/**
 * Wheel direction token ("wheelup"/"wheeldown") for a vertical wheel delta.
 * Returns null when there is no vertical motion so horizontal-only wheel
 * events are never treated as zoom and keep their default behavior.
 */
export function wheelDirectionForDelta(
	deltaY: number,
): "wheelup" | "wheeldown" | null {
	if (deltaY < 0) return WHEEL_UP;
	if (deltaY > 0) return WHEEL_DOWN;
	return null;
}

/**
 * Exact modifier equality against a DOM-shaped event. Requiring equality
 * (rather than "has these modifiers") is what lets a `Ctrl+WheelUp` binding
 * coexist with a `Ctrl+Shift+WheelUp` one without either swallowing the other.
 */
export function modifiersMatch(
	p: ParsedBinding,
	e: {
		ctrlKey?: boolean;
		altKey?: boolean;
		shiftKey?: boolean;
		metaKey?: boolean;
	},
): boolean {
	return (
		Boolean(e.ctrlKey) === p.ctrl &&
		Boolean(e.altKey) === p.alt &&
		Boolean(e.shiftKey) === p.shift &&
		Boolean(e.metaKey) === p.meta
	);
}

export type WheelEventLike = {
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	metaKey?: boolean;
	deltaY: number;
};

export function bindingMatchesWheel(
	p: ParsedBinding | null | undefined,
	e: WheelEventLike,
): boolean {
	if (p?.kind !== "wheel" || !modifiersMatch(p, e)) return false;
	const dir = wheelDirectionForDelta(e.deltaY);
	if (!dir) return false;
	const key = p.key.toLowerCase();
	return key === WHEEL || key === dir;
}

/** First action whose parsed wheel binding matches, or null when none do. */
export function firstMatchingWheelAction(
	parsed: Readonly<Record<string, ParsedBinding | null>>,
	actions: readonly string[],
	e: WheelEventLike,
): string | null {
	for (const action of actions) {
		if (bindingMatchesWheel(parsed[action], e)) return action;
	}
	return null;
}

export const DEFAULT_BINDS: Record<string, string> = {
	pane_split_down: "Alt+H",
	pane_split_right: "Alt+V",
	profile_split_down: "Alt+Shift+H",
	profile_split_right: "Alt+Shift+V",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_close: "Ctrl+Shift+W",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_float_toggle: "Ctrl+Shift+O",
	pane_float_new: "Alt+O",
	profile_float_new: "Alt+Shift+O",
	pane_float_follow: "Alt+F",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_focus_left: "Alt+ArrowLeft",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_focus_right: "Alt+ArrowRight",
	pane_focus_up: "Alt+ArrowUp",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_focus_down: "Alt+ArrowDown",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_swap_left: "Ctrl+Shift+ArrowLeft",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_swap_right: "Ctrl+Shift+ArrowRight",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_swap_up: "Ctrl+Shift+ArrowUp",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_swap_down: "Ctrl+Shift+ArrowDown",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	pane_move_to_tab: "Ctrl+Shift+{n}",
	tab_switch: "Alt+{n}",
	window_toggle: "Alt+Shift+T",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	window_move_next_monitor: "Alt+Shift+ArrowRight",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	window_move_prev_monitor: "Alt+Shift+ArrowLeft",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	window_maximize: "Alt+Shift+ArrowUp",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	window_restore: "Alt+Shift+ArrowDown",
	settings_open: "Ctrl+,",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	palette_open: "Ctrl+Shift+P",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	palette_chord: "Ctrl+Shift+P",
	help_toggle: "Ctrl+Shift+/",

	terminal_newline: "Shift+Enter",
	terminal_copy: "Ctrl+C",
	terminal_paste: "Ctrl+V",
	// Split wheel font zoom: `Ctrl+wheel` scales the hovered terminal while
	// `Ctrl+Shift+wheel` scales every visible terminal synchronously.
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	terminal_zoom_in: "Ctrl+WheelUp",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	terminal_zoom_out: "Ctrl+WheelDown",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	terminal_zoom_all_in: "Ctrl+Shift+WheelUp",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	terminal_zoom_all_out: "Ctrl+Shift+WheelDown",
	// biome-ignore lint/security/noSecrets: keybind literal, not a secret
	dev_toggle: "Ctrl+Shift+D",
};

/** Wheel actions that scale the hovered/focused terminal. */
export const ZOOM_HOVERED_ACTIONS = [
	"terminal_zoom_in",
	"terminal_zoom_out",
] as const;

/** Wheel actions that scale every visible terminal at once. */
export const ZOOM_ALL_VISIBLE_ACTIONS = [
	"terminal_zoom_all_in",
	"terminal_zoom_all_out",
] as const;

export const WHEEL_ZOOM_ACTIONS: readonly string[] = [
	...ZOOM_HOVERED_ACTIONS,
	...ZOOM_ALL_VISIBLE_ACTIONS,
];

const ZOOM_ALL_SET: ReadonlySet<string> = new Set(ZOOM_ALL_VISIBLE_ACTIONS);
const ZOOM_IN_SET: ReadonlySet<string> = new Set([
	"terminal_zoom_in",
	"terminal_zoom_all_in",
]);

/** +1 for *_in actions, -1 for *_out actions (never 0 for known actions). */
export function zoomDirectionForAction(action: string): 1 | -1 {
	return ZOOM_IN_SET.has(action) ? 1 : -1;
}

/** Whether the zoom action targets every visible terminal, not just one. */
export function zoomAppliesToAllVisible(action: string): boolean {
	return ZOOM_ALL_SET.has(action);
}
