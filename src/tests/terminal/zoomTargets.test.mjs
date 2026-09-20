/**
 * Deterministic unit tests for all-visible zoom target selection
 * (zoomTargets.ts). No browser, no Tauri: the module is pure, so
 * node --experimental-strip-types can import it directly.
 *
 * Mirrors the production wiring in main.ts: panes are described by host
 * (active vs not), follow status, and liveness; the helper returns the
 * order-preserving, dedup'd "currently visible" set that the wheel batch feeds.
 *
 * Run: node --experimental-strip-types --test src/tests/terminal/zoomTargets.test.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const { selectVisibleZoomPaneIds } = await import(
	"../../terminal/zoomTargets.ts"
);

/** Build a normalized pane descriptor (mirrors main.ts's production shape). */
function pane(id, overrides = {}) {
	return { id, hostActive: false, following: false, live: true, ...overrides };
}

test("active host leaves (tiled and floating) are visible", () => {
	const panes = [
		pane("main", { hostActive: true }),
		pane("a2", { hostActive: true, following: true }),
		pane("a3", { hostActive: true }),
	];
	assert.deepEqual(selectVisibleZoomPaneIds(panes), ["main", "a2", "a3"]);
});

test("hidden inactive tab leaves are excluded even when live", () => {
	const panes = [
		pane("active-pane", { hostActive: true }),
		pane("inactive-tiled", { hostActive: false }),
		pane("inactive-floating", { hostActive: false, following: false }),
	];
	assert.deepEqual(selectVisibleZoomPaneIds(panes), ["active-pane"]);
});

test("follow floats from other tabs stay visible across tab switches", () => {
	const panes = [
		pane("active-pane", { hostActive: true }),
		pane("follow-from-other-tab", { hostActive: false, following: true }),
	];
	assert.deepEqual(selectVisibleZoomPaneIds(panes), [
		"active-pane",
		"follow-from-other-tab",
	]);
});

test("non-live (deferred/dismissed) panes are excluded", () => {
	const panes = [
		pane("live-active", { hostActive: true }),
		pane("deferred-active", { hostActive: true, live: false }),
		pane("deferred-follow", {
			hostActive: false,
			following: true,
			live: false,
		}),
	];
	assert.deepEqual(selectVisibleZoomPaneIds(panes), ["live-active"]);
});

test("duplicate ids across hosts are deduped (order-preserving)", () => {
	const panes = [
		pane("main", { hostActive: true }),
		pane("shared", { hostActive: true, following: true }),
		pane("shared", { hostActive: false, following: true }),
		pane("tail", { hostActive: true }),
	];
	assert.deepEqual(selectVisibleZoomPaneIds(panes), ["main", "shared", "tail"]);
});

test("an empty or all-hidden set yields nothing", () => {
	assert.deepEqual(selectVisibleZoomPaneIds([]), []);
	assert.deepEqual(
		selectVisibleZoomPaneIds([
			pane("hidden", { hostActive: false, following: false }),
		]),
		[],
	);
});
