/**
 * Deterministic unit tests for the Ctrl+wheel zoom step math (zoomStep.ts).
 *
 * No browser and no DOM: the module is pure, so node --experimental-strip-types
 * can import it directly. Asserts fractional (non-truncated) step application,
 * direction, font-size bounds, and zoom-step setting validation/clamping.
 *
 * Run: node --experimental-strip-types --test src/tests/zoomStep.test.mjs
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");

const MODULE_URL = pathToFileURL(
	resolve(REPO, "src/terminal/zoomStep.ts"),
).href;

const {
	ZOOM_FONT_MIN,
	ZOOM_FONT_MAX,
	ZOOM_STEP_DEFAULT,
	ZOOM_STEP_MIN,
	ZOOM_STEP_MAX,
	nextZoomFontSize,
	normalizeZoomStep,
} = await import(MODULE_URL);

function assertFontSize(actual, expected) {
	assert.ok(
		Math.abs(actual - expected) < 1e-9,
		`expected ${expected}, got ${actual}`,
	);
}

test("exports a default zoom step of 0.25px with a 0.05..2 range", () => {
	assert.equal(ZOOM_STEP_DEFAULT, 0.25);
	assert.ok(ZOOM_STEP_MIN > 0 && ZOOM_STEP_MIN < ZOOM_STEP_DEFAULT);
	assert.ok(ZOOM_STEP_MAX > ZOOM_STEP_DEFAULT);
	assert.ok(ZOOM_FONT_MIN < ZOOM_FONT_MAX);
});

test("wheel direction: positive delta grows, negative shrinks, fraction kept", () => {
	assertFontSize(nextZoomFontSize(10, 0.25), 10.25);
	assertFontSize(nextZoomFontSize(10.25, 0.25), 10.5);
	assertFontSize(nextZoomFontSize(10.5, -0.25), 10.25);
});

test("never truncates decimals to integers (0.1 steps stay fractional)", () => {
	assertFontSize(nextZoomFontSize(12, 0.1), 12.1);
	assertFontSize(nextZoomFontSize(12.1, 0.1), 12.2);
	assertFontSize(nextZoomFontSize(12.8, -0.05), 12.75);
});

test("clamps at the font-size zoom bounds", () => {
	assertFontSize(nextZoomFontSize(ZOOM_FONT_MAX, 0.25), ZOOM_FONT_MAX);
	assertFontSize(nextZoomFontSize(ZOOM_FONT_MAX - 0.1, 0.25), ZOOM_FONT_MAX);
	assertFontSize(nextZoomFontSize(ZOOM_FONT_MIN, -0.25), ZOOM_FONT_MIN);
	assertFontSize(nextZoomFontSize(ZOOM_FONT_MIN + 0.1, -0.25), ZOOM_FONT_MIN);
});

test("quantizes away binary-float drift while preserving the decimal", () => {
	assertFontSize(nextZoomFontSize(12.1, 0.05), 12.15);
	assertFontSize(nextZoomFontSize(32, 0.1), 32);
});

test("normalizeZoomStep falls back to the default for empty/non-finite input", () => {
	assert.equal(normalizeZoomStep(undefined), ZOOM_STEP_DEFAULT);
	assert.equal(normalizeZoomStep(Number.NaN), ZOOM_STEP_DEFAULT);
	assert.equal(normalizeZoomStep(Number.POSITIVE_INFINITY), ZOOM_STEP_DEFAULT);
});

test("normalizeZoomStep clamps out-of-range editing into the valid range", () => {
	assert.equal(normalizeZoomStep(0.03), ZOOM_STEP_MIN);
	assert.equal(normalizeZoomStep(0), ZOOM_STEP_MIN);
	assert.equal(normalizeZoomStep(-1), ZOOM_STEP_MIN);
	assert.equal(normalizeZoomStep(5), ZOOM_STEP_MAX);
	assert.equal(normalizeZoomStep(100), ZOOM_STEP_MAX);
});

test("normalizeZoomStep keeps a valid in-range step (incl. 2 decimals)", () => {
	assert.equal(normalizeZoomStep(0.25), 0.25);
	assert.equal(normalizeZoomStep(0.5), 0.5);
	assert.equal(normalizeZoomStep(1), 1);
	assert.equal(normalizeZoomStep(2), 2);
});

test("multi-notch accumulation equals notches × step (all-visible flush delta)", () => {
	assertFontSize(nextZoomFontSize(12, 3 * 0.25), 12.75);
	assertFontSize(nextZoomFontSize(12, -3 * 0.25), 11.25);
	assertFontSize(nextZoomFontSize(12, 2 * 0.1), 12.2);
});

test("same delta applied to differing starts preserves each pane's difference", () => {
	// Zoom-all-visible must scale every pane by the same notch, never reset
	// them to a common size. Unclamped panes move by exactly the same amount.
	const starts = [10, 11.25, 12.5, 20];
	const delta = 2 * 0.25;
	const next = starts.map((s) => nextZoomFontSize(s, delta));
	for (let i = 0; i < starts.length; i++) {
		assertFontSize(next[i], starts[i] + delta);
	}
});

test("clamps apply per pane, not as a shared cap", () => {
	// At the ceiling a pane stops, while a lower pane keeps scaling.
	assertFontSize(nextZoomFontSize(ZOOM_FONT_MAX - 0.2, 0.5), ZOOM_FONT_MAX);
	assertFontSize(nextZoomFontSize(10, 0.5), 10.5);
	assertFontSize(nextZoomFontSize(ZOOM_FONT_MIN + 0.2, -0.5), ZOOM_FONT_MIN);
	assertFontSize(nextZoomFontSize(30, -0.5), 29.5);
});
