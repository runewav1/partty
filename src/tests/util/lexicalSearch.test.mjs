/**
 * Regression tests for the shared lexical matcher (src/util/lexicalSearch.ts).
 *
 * The matcher backs the command palette, theme picker, settings search and the
 * profile/workspace pickers. These tests pin its semantics: whitespace
 * tokenization, multi-token AND, substring/token-prefix matching, and the
 * ranking tie-breaks. They are the safety net for the palette's filtering/order
 * characterization because the palette renders exactly this function's output.
 *
 * Run: node --experimental-strip-types --test src/tests/util/lexicalSearch.test.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const { filterAndRankLexical, normalizeQuery } = await import(
	"../../util/lexicalSearch.ts"
);

const ITEMS = [
	{ id: "term-font", label: "Font size", keywords: "text px terminal" },
	{ id: "term-weight", label: "Font weight", keywords: "text bold terminal" },
	{ id: "cursor", label: "Cursor blink", keywords: "caret" },
	{ id: "theme-dark", label: "GitHub — Dark", keywords: "appearance colors" },
];

const ids = (rows) => rows.map((row) => row.id);

test("normalizeQuery lowercases, trims and splits on whitespace", () => {
	assert.deepEqual(normalizeQuery("  Git Dark  "), ["git", "dark"]);
	assert.deepEqual(normalizeQuery("   "), []);
});

test("an empty query returns every item in original order", () => {
	assert.deepEqual(ids(filterAndRankLexical(ITEMS, [])), [
		"term-font",
		"term-weight",
		"cursor",
		"theme-dark",
	]);
});

test("multi-token queries AND across label, keywords and id", () => {
	assert.deepEqual(
		ids(filterAndRankLexical(ITEMS, normalizeQuery("git dark"))),
		["theme-dark"],
	);
	assert.deepEqual(
		ids(filterAndRankLexical(ITEMS, normalizeQuery("text terminal"))),
		["term-font", "term-weight"],
	);
	// Tokens spread across different items must not match.
	assert.deepEqual(
		ids(filterAndRankLexical(ITEMS, normalizeQuery("bold caret"))),
		[],
	);
});

test("tokens match as substrings or token prefixes", () => {
	assert.deepEqual(ids(filterAndRankLexical(ITEMS, normalizeQuery("cur"))), [
		"cursor",
	]);
	assert.deepEqual(ids(filterAndRankLexical(ITEMS, normalizeQuery("blin"))), [
		"cursor",
	]);
	assert.deepEqual(
		ids(filterAndRankLexical(ITEMS, normalizeQuery("term font"))),
		["term-font", "term-weight"],
	);
});

test("a label match outranks a keyword-only match", () => {
	const ranked = [
		{ id: "keyword", label: "Zeta", keywords: "alpha" },
		{ id: "label", label: "Alpha", keywords: "zeta" },
	];
	assert.deepEqual(ids(filterAndRankLexical(ranked, normalizeQuery("alpha"))), [
		"label",
		"keyword",
	]);
});

test("equal scores break toward the shorter label", () => {
	const ties = [
		{ id: "long", label: "New tab extended" },
		{ id: "short", label: "New tab" },
	];
	assert.deepEqual(ids(filterAndRankLexical(ties, normalizeQuery("new"))), [
		"short",
		"long",
	]);
});
