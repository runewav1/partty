/**
 * Regression tests for the pure settings search matcher
 * (src/app/settingsSearch.ts).
 *
 * The settings panel renders one `.settings-item` per preference; the DOM
 * layer folds each item into plain metadata and delegates filtering here. These
 * tests pin the behaviours that make search land on an individual preference:
 * multi-token AND, description/option matches surfacing the parent item,
 * pref-name hits, keyword synonyms, and separator/case normalization.
 *
 * Run: node --experimental-strip-types --test src/tests/app/settingsSearch.test.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const { filterSettingsItems, settingsItemText } = await import(
	"../../app/settingsSearch.ts"
);

const ITEMS = [
	{ label: "Font size", pref: "terminal_font_size", keywords: "text px" },
	{ label: "Font weight", pref: "terminal_font_weight" },
	{ label: "Cursor blink", pref: "terminal_cursor_blink" },
	{
		label: "Keep session",
		pref: "retain_session_state",
		desc: "Remember pane layouts, directories, and tabs across restarts.",
	},
	{
		label: "OSC 52 clipboard",
		pref: "osc52",
		keywords: "clipboard remote copy paste",
		desc: "Allow remote programs to read/write the local clipboard.",
	},
];

const labels = (matches) => matches.map((m) => m.label);

test("multi-token query requires every token to match (AND)", () => {
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "font size")), [
		"Font size",
	]);
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "font weight")), [
		"Font weight",
	]);
	// Tokens spread across different items must not match.
	assert.deepEqual(filterSettingsItems(ITEMS, "size weight"), []);
});

test("a description-only match surfaces the control item", () => {
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "directories")), [
		"Keep session",
	]);
});

test("matches a preference name from data-pref", () => {
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "terminal_font_size")), [
		"Font size",
	]);
	// The joined pref also matches when written with spaces.
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "terminal font size")), [
		"Font size",
	]);
});

test("matches synonyms supplied via keywords", () => {
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "remote")), [
		"OSC 52 clipboard",
	]);
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "px")), ["Font size"]);
});

test("normalizes case, surrounding whitespace, and underscores", () => {
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "  CURSOR_BLINK  ")), [
		"Cursor blink",
	]);
	assert.deepEqual(
		labels(filterSettingsItems(ITEMS, "Terminal_Cursor_Blink")),
		["Cursor blink"],
	);
});

test("matches token prefixes like the shared lexical matcher", () => {
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "reta")), [
		"Keep session",
	]);
	assert.deepEqual(labels(filterSettingsItems(ITEMS, "curs")), [
		"Cursor blink",
	]);
});

test("an empty or blank query matches every item", () => {
	assert.equal(filterSettingsItems(ITEMS, "").length, ITEMS.length);
	assert.equal(filterSettingsItems(ITEMS, "   ").length, ITEMS.length);
});

test("settingsItemText folds and normalizes every field", () => {
	const text = settingsItemText({
		label: "Font size",
		pref: "terminal_font_size",
		keywords: "text px",
		desc: "Terminal text",
		controlText: "number",
	});
	assert.ok(text.includes("font size"));
	assert.ok(text.includes("terminal font size"));
	assert.ok(text.includes("text px"));
	assert.ok(text.includes("terminal text"));
	assert.ok(text.includes("number"));
	assert.ok(!text.includes("_"));
});
