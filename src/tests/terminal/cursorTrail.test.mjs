/**
 * Deterministic unit tests for the cursor trail preference adapter
 * (src/terminal/cursorTrail.ts).
 *
 * The module has no runtime xterm dependency, so node --experimental-strip-types
 * can import it directly. These tests pin the kitty defaults, the
 * validation/clamping that must match the xterm.js core sanitizers, the
 * snake_case -> camelCase mapping used to propagate the option to panes, and
 * the color canonicalization (including fully transparent colors).
 *
 * Run: node --experimental-strip-types --test src/tests/terminal/cursorTrail.test.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const {
	CURSOR_TRAIL_COLOR_NONE,
	DEFAULT_CURSOR_TRAIL_DECAY,
	DEFAULT_CURSOR_TRAIL_START_THRESHOLD,
	cursorTrailToXtermOptions,
	normalizeTrailColor,
	sanitizeCursorTrail,
	sanitizeCursorTrailDecay,
	sanitizeCursorTrailStartThreshold,
} = await import("../../terminal/cursorTrail.ts");

const HSL_RE = /^hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/;

test("defaults match kitty and the trail is off", () => {
	const o = cursorTrailToXtermOptions(undefined);
	assert.equal(o.cursorTrail, 0);
	assert.deepEqual(o.cursorTrailDecay, [0.1, 0.4]);
	assert.equal(o.cursorTrailStartThreshold, 2);
	assert.equal(o.cursorTrailColor, CURSOR_TRAIL_COLOR_NONE);
	// Missing/partial persisted config (old configs without the new keys).
	assert.deepEqual(cursorTrailToXtermOptions(null), o);
	assert.deepEqual(cursorTrailToXtermOptions({}), o);
});

test("new keys map straight through and an explicit zero wins", () => {
	const o = cursorTrailToXtermOptions({
		terminal_cursor_trail: 0,
		terminal_cursor_trail_decay: [0.05, 0.2],
		terminal_cursor_trail_start_threshold: [1, 3],
		terminal_cursor_trail_color: "#ff00ff",
	});
	assert.equal(o.cursorTrail, 0);
	assert.deepEqual(o.cursorTrailDecay, [0.05, 0.2]);
	assert.deepEqual(o.cursorTrailStartThreshold, [1, 3]);
	assert.equal(o.cursorTrailColor, "#ff00ff");
});

test("trail clamps match the core sanitizer", () => {
	assert.equal(sanitizeCursorTrail(250.9), 250);
	assert.equal(sanitizeCursorTrail(-5), 0);
	assert.equal(sanitizeCursorTrail(Number.NaN), 0);
	assert.equal(sanitizeCursorTrail(Number.POSITIVE_INFINITY), 0);
	assert.equal(sanitizeCursorTrail("42"), 42);
});

test("decay is a non-negative pair with slow lifted to fast", () => {
	assert.deepEqual(sanitizeCursorTrailDecay([0.4, 0.1]), [0.4, 0.4]);
	assert.deepEqual(sanitizeCursorTrailDecay([0, 0]), [0, 0]);
	// Missing slots fall back to the kitty default.
	assert.deepEqual(sanitizeCursorTrailDecay([0.2]), [0.2, 0.4]);
	assert.deepEqual(sanitizeCursorTrailDecay(undefined), [0.1, 0.4]);
	assert.deepEqual(
		sanitizeCursorTrailDecay([Number.NaN, Number.POSITIVE_INFINITY]),
		[0.1, 0.4],
	);
});

test("start threshold accepts a scalar or an x/y pair", () => {
	assert.equal(sanitizeCursorTrailStartThreshold(5), 5);
	assert.deepEqual(sanitizeCursorTrailStartThreshold([1, 3]), [1, 3]);
	// Floored to whole non-negative cells.
	assert.deepEqual(sanitizeCursorTrailStartThreshold([-3, 2.9]), [0, 2]);
	assert.equal(sanitizeCursorTrailStartThreshold(Number.NaN), 2);
	assert.equal(DEFAULT_CURSOR_TRAIL_START_THRESHOLD, 2);
});

test("color accepts strict hex/rgb(a) and canonicalizes to hex", () => {
	assert.equal(normalizeTrailColor("#ff00ff"), "#ff00ff");
	assert.equal(normalizeTrailColor("#ABC"), "#aabbcc");
	assert.equal(normalizeTrailColor("#abcd"), "#aabbccdd");
	assert.equal(normalizeTrailColor("rgb(255, 0, 255)"), "#ff00ff");
	assert.equal(normalizeTrailColor("rgba(255, 0, 255, 0.5)"), "#ff00ff80");
	assert.equal(normalizeTrailColor("rgb(999, 0, 300)"), "#ff00ff");
	assert.equal(normalizeTrailColor("rgb(1, 2)"), undefined);
	assert.equal(normalizeTrailColor("   "), undefined);
	assert.equal(normalizeTrailColor("none"), undefined);
	assert.equal(normalizeTrailColor("nope"), undefined);
	for (const keyword of [
		"inherit",
		"initial",
		"unset",
		"revert",
		"revert-layer",
		"currentcolor",
	]) {
		assert.equal(normalizeTrailColor(keyword), undefined, keyword);
	}
	// Fully transparent must not fall back to the visible theme color.
	assert.equal(normalizeTrailColor("transparent"), "#00000000");
	assert.equal(
		cursorTrailToXtermOptions({ terminal_cursor_trail_color: "transparent" })
			.cursorTrailColor,
		"#00000000",
	);
});

/**
 * Minimal canvas stub mirroring the parts of the 2D context `normalizeTrailColor`
 * uses: an ignored-on-invalid `fillStyle` (sentinel gradient survives invalid
 * assignments) and `getImageData` returning the parsed pixel. Supports a couple
 * of named colors and HSL so canonicalization can be asserted.
 */
function installFakeCanvasDom() {
	const hslToRgb = (h, s, l) => {
		s /= 100;
		l /= 100;
		const c = (1 - Math.abs(2 * l - 1)) * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = l - c / 2;
		let rgb = [0, 0, 0];
		if (h < 60) rgb = [c, x, 0];
		else if (h < 120) rgb = [x, c, 0];
		else if (h < 180) rgb = [0, c, x];
		else if (h < 240) rgb = [0, x, c];
		else if (h < 300) rgb = [x, 0, c];
		else rgb = [c, 0, x];
		return [
			Math.round((rgb[0] + m) * 255),
			Math.round((rgb[1] + m) * 255),
			Math.round((rgb[2] + m) * 255),
			255,
		];
	};
	const named = { red: [255, 0, 0, 255], rebeccapurple: [102, 51, 153, 255] };
	const parse = (raw) => {
		const s = String(raw).trim().toLowerCase();
		if (s in named) return named[s];
		const hsl = HSL_RE.exec(s);
		if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
		return undefined;
	};
	const makeContext = () => {
		let fill = null;
		return {
			globalCompositeOperation: "source-over",
			get fillStyle() {
				return fill;
			},
			set fillStyle(value) {
				if (value && typeof value === "object") {
					fill = value;
					return;
				}
				if (parse(value)) fill = String(value);
			},
			createLinearGradient: () => ({ isGradient: true }),
			fillRect: () => {},
			getImageData: () => ({
				data: (fill && typeof fill === "string" && parse(fill)) || [0, 0, 0, 0],
			}),
		};
	};
	const canvas = { width: 0, height: 0, getContext: () => makeContext() };
	const hadDocument = "document" in globalThis;
	const previousDocument = globalThis.document;
	globalThis.document = {
		createElement: (tag) =>
			String(tag).toLowerCase() === "canvas" ? canvas : { style: {} },
	};
	return () => {
		globalThis.document = hadDocument ? previousDocument : undefined;
	};
}

test("color canonicalizes named/HSL through the browser canvas parser", () => {
	const restore = installFakeCanvasDom();
	try {
		assert.equal(normalizeTrailColor("red"), "#ff0000");
		assert.equal(normalizeTrailColor("rebeccapurple"), "#663399");
		assert.equal(normalizeTrailColor("hsl(0, 100%, 50%)"), "#ff0000");
		assert.equal(normalizeTrailColor("currentcolor"), undefined);
		assert.equal(normalizeTrailColor("not-a-color"), undefined);
		assert.equal(normalizeTrailColor("transparent"), "#00000000");
		assert.equal(
			cursorTrailToXtermOptions({ terminal_cursor_trail_color: "red" })
				.cursorTrailColor,
			"#ff0000",
		);
	} finally {
		restore();
	}
	assert.equal(normalizeTrailColor("red"), undefined, "DOM stub removed");
});

test("the adapter returns fresh objects and arrays for each runtime apply", () => {
	const a = cursorTrailToXtermOptions({ terminal_cursor_trail: 100 });
	const b = cursorTrailToXtermOptions({ terminal_cursor_trail: 100 });
	assert.notEqual(a, b);
	assert.notEqual(a.cursorTrailDecay, b.cursorTrailDecay);
	a.cursorTrailDecay[0] = 9;
	assert.deepEqual(b.cursorTrailDecay, [...DEFAULT_CURSOR_TRAIL_DECAY]);
	assert.deepEqual(DEFAULT_CURSOR_TRAIL_DECAY, [0.1, 0.4]);
});

test("JSON persistence round-trip keeps every option", () => {
	const persisted = {
		terminal_cursor_trail: 333,
		terminal_cursor_trail_decay: [0.25, 0.5],
		terminal_cursor_trail_start_threshold: [1, 4],
		terminal_cursor_trail_color: "#abcdef",
	};
	const restored = cursorTrailToXtermOptions(
		JSON.parse(JSON.stringify(persisted)),
	);
	assert.equal(restored.cursorTrail, 333);
	assert.deepEqual(restored.cursorTrailDecay, [0.25, 0.5]);
	assert.deepEqual(restored.cursorTrailStartThreshold, [1, 4]);
	assert.equal(restored.cursorTrailColor, "#abcdef");
});
