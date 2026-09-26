/**
 * Cursor trail preference adapter.
 *
 * The trail is xterm.js's kitty-compatible cursor trail: a short streak drawn
 * between the cursor's previous and current positions. The four core options
 * are flat on `ITerminalOptions` (see `cursorTrail`, `cursorTrailDecay`,
 * `cursorTrailStartThreshold`, `cursorTrailColor`), so this module only
 * normalizes the flat persisted IPC values and maps the snake_case fields onto
 * those camelCase names. There is no enable/style/samples/opacity/easing knob;
 * `cursorTrail = 0` disables the feature and the renderer honors the OS
 * reduced-motion setting on its own.
 *
 * Explicit colors are re-emitted as strict hex (including alpha, so a fully
 * transparent color stays transparent instead of falling back to the visible
 * theme), while blank/`none`/invalid values fall back to the theme cursor color.
 */

/** Flat IPC shape persisted by `prefs::Prefs` (snake_case keys). */
export type CursorTrailPrefs = {
	/** Stationary delay in ms; `0` disables the trail (kitty `cursor_trail`). */
	terminal_cursor_trail?: number | null;
	/** `[fast, slow]` decay in seconds (kitty `cursor_trail_decay`). */
	terminal_cursor_trail_decay?: readonly number[] | null;
	/** `number` applies to both axes, `[x, y]` sets them independently. */
	terminal_cursor_trail_start_threshold?: number | readonly number[] | null;
	/** CSS color override; `none` follows the theme cursor color. */
	terminal_cursor_trail_color?: string | null;
};

/** Footprint accepted by {@link cursorTrailToXtermOptions}. */
export type CursorTrailSource = Partial<CursorTrailPrefs>;

/** `number | [number, number]` start threshold, as accepted by the core. */
export type CursorTrailThreshold = number | [number, number];

/** Flat camelCase cursor trail options for {@link ITerminalOptions}. */
export type CursorTrailOptions = {
	cursorTrail: number;
	cursorTrailDecay: [number, number];
	cursorTrailStartThreshold: CursorTrailThreshold;
	cursorTrailColor: string;
};

/** `cursorTrailColor` sentinel meaning "use the theme cursor color". */
export const CURSOR_TRAIL_COLOR_NONE = "none";
/** kitty `cursor_trail_decay` default, `[fast, slow]` seconds. */
export const DEFAULT_CURSOR_TRAIL_DECAY: readonly [number, number] = [0.1, 0.4];
/** kitty `cursor_trail_start_threshold` default (both axes), in cells. */
export const DEFAULT_CURSOR_TRAIL_START_THRESHOLD = 2;

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR_RE =
	/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|\d?\.\d+)\s*)?\)$/i;
const CONTEXTUAL_COLOR_RE =
	/^(?:inherit|initial|unset|revert|revert-layer|currentcolor)$/i;

function clampChannel(n: number): number {
	return Math.max(0, Math.min(255, Math.round(n)));
}

/** Emit strict hex xterm can parse without its throwing canvas fallback. */
function rgbaToHex(r: number, g: number, b: number, a: number): string {
	const byte = (n: number) => clampChannel(n).toString(16).padStart(2, "0");
	const base = `#${byte(r)}${byte(g)}${byte(b)}`;
	return a >= 255 ? base : `${base}${byte(a)}`;
}

function parseHexColor(value: string): string | undefined {
	const match = HEX_COLOR_RE.exec(value);
	if (!match) return undefined;
	const h = match[1];
	if (h.length === 3 || h.length === 4) {
		return rgbaToHex(
			Number.parseInt(h[0] + h[0], 16),
			Number.parseInt(h[1] + h[1], 16),
			Number.parseInt(h[2] + h[2], 16),
			h.length === 4 ? Number.parseInt(h[3] + h[3], 16) : 255,
		);
	}
	return rgbaToHex(
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
		h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) : 255,
	);
}

function parseRgbColor(value: string): string | undefined {
	const match = RGB_COLOR_RE.exec(value);
	if (!match) return undefined;
	const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
	return rgbaToHex(
		Number.parseInt(match[1], 10),
		Number.parseInt(match[2], 10),
		Number.parseInt(match[3], 10),
		Math.round(alpha * 255),
	);
}

/**
 * Canonicalize any other browser-supported color (named, `hsl()`, ...) with the
 * same canvas `fillStyle` mechanism xterm uses. An invalid assignment leaves a
 * sentinel gradient in place, so we reject it; accepted pixels are re-emitted as
 * strict hex, preserving alpha including fully transparent colors.
 */
function canvasTrailColor(value: string): string | undefined {
	if (typeof document === "undefined") return undefined;
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return undefined;
	const sentinel = ctx.createLinearGradient(0, 0, 1, 1);
	ctx.globalCompositeOperation = "copy";
	ctx.fillStyle = sentinel;
	ctx.fillStyle = value;
	if (typeof ctx.fillStyle !== "string") return undefined;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	return rgbaToHex(r, g, b, a);
}

/**
 * Validate/normalize a color override. Returns `undefined` when the value means
 * "use the theme cursor color" (blank, `none`, a CSS-wide keyword, or an
 * unparseable color); otherwise a strict hex string. `transparent` and any
 * alpha channel are preserved, so a fully transparent color is never replaced
 * by the visible theme color.
 */
export function normalizeTrailColor(value: string): string | undefined {
	const v = value.trim();
	if (!v || v.toLowerCase() === CURSOR_TRAIL_COLOR_NONE) return undefined;
	if (CONTEXTUAL_COLOR_RE.test(v)) return undefined;
	if (v.toLowerCase() === "transparent") return "#00000000";
	return parseHexColor(v) ?? parseRgbColor(v) ?? canvasTrailColor(v);
}

function toFiniteNumber(value: unknown, fallback: number): number {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function clampNonNegative(value: unknown, fallback: number): number {
	const number = toFiniteNumber(value, fallback);
	return number > 0 ? number : 0;
}

/** `cursorTrail`: floor to whole non-negative milliseconds (`0` disables). */
export function sanitizeCursorTrail(value: unknown): number {
	return Math.floor(clampNonNegative(value, 0));
}

/**
 * `cursorTrailDecay`: `[fast, slow]` seconds, non-negative, with `slow` lifted
 * to at least `fast`. Non-finite values fall back to the kitty default.
 */
export function sanitizeCursorTrailDecay(value: unknown): [number, number] {
	const input = Array.isArray(value) ? value : [];
	const fast = clampNonNegative(input[0], DEFAULT_CURSOR_TRAIL_DECAY[0]);
	let slow = clampNonNegative(input[1], DEFAULT_CURSOR_TRAIL_DECAY[1]);
	if (slow < fast) slow = fast;
	return [fast, slow];
}

/**
 * `cursorTrailStartThreshold`: a single number applies to both axes, an array
 * sets `[x, y]`; each axis is floored to a non-negative cell count.
 */
export function sanitizeCursorTrailStartThreshold(
	value: unknown,
): CursorTrailThreshold {
	if (Array.isArray(value)) {
		return [
			Math.floor(
				clampNonNegative(value[0], DEFAULT_CURSOR_TRAIL_START_THRESHOLD),
			),
			Math.floor(
				clampNonNegative(value[1], DEFAULT_CURSOR_TRAIL_START_THRESHOLD),
			),
		];
	}
	return Math.floor(
		clampNonNegative(value, DEFAULT_CURSOR_TRAIL_START_THRESHOLD),
	);
}

function hasValue(value: unknown): boolean {
	return value !== undefined && value !== null;
}

/**
 * Resolve persisted preferences into the flat core options. Always returns a
 * fresh object (with a fresh decay array) so assigning it at runtime triggers
 * the core's option sanitizer/repaint.
 */
export function cursorTrailToXtermOptions(
	raw?: CursorTrailSource | null,
): CursorTrailOptions {
	const input = raw ?? {};
	const color =
		hasValue(input.terminal_cursor_trail_color) &&
		typeof input.terminal_cursor_trail_color === "string"
			? (normalizeTrailColor(input.terminal_cursor_trail_color) ??
				CURSOR_TRAIL_COLOR_NONE)
			: CURSOR_TRAIL_COLOR_NONE;

	return {
		cursorTrail: hasValue(input.terminal_cursor_trail)
			? sanitizeCursorTrail(input.terminal_cursor_trail)
			: 0,
		cursorTrailDecay: hasValue(input.terminal_cursor_trail_decay)
			? sanitizeCursorTrailDecay(input.terminal_cursor_trail_decay)
			: [...DEFAULT_CURSOR_TRAIL_DECAY],
		cursorTrailStartThreshold: hasValue(
			input.terminal_cursor_trail_start_threshold,
		)
			? sanitizeCursorTrailStartThreshold(
					input.terminal_cursor_trail_start_threshold,
				)
			: DEFAULT_CURSOR_TRAIL_START_THRESHOLD,
		cursorTrailColor: color,
	};
}
