/**
 * Regression tests for the pure terminal find scanner (src/app/findScan.ts).
 *
 * The scanner walks xterm buffer cells directly, so these tests pin the two
 * behaviours the old string-index search got wrong: wide glyphs must map to the
 * correct cell columns, and matches spanning a soft-wrapped logical line must be
 * found and split into per-visual-line segments.
 *
 * Run: node --experimental-strip-types --test src/tests/findScan.test.mjs
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MODULE_URL = pathToFileURL(resolve(REPO, "src/app/findScan.ts")).href;

const { scanBuffer } = await import(MODULE_URL);

function cell(chars, width = 1) {
	return { getWidth: () => width, getChars: () => chars };
}

function line(cells, isWrapped = false) {
	return {
		isWrapped,
		length: cells.length,
		getCell: (x) => cells[x],
	};
}

function buffer(lines) {
	return { length: lines.length, getLine: (y) => lines[y] };
}

test("finds every occurrence on a single line with cell coordinates", () => {
	const buf = buffer([line([..."foofoo"].map((c) => cell(c)))]);
	const matches = scanBuffer(buf, "foo");
	assert.equal(matches.length, 2);
	assert.deepEqual(matches[0].segments, [{ line: 0, start: 0, length: 3 }]);
	assert.deepEqual(matches[1].segments, [{ line: 0, start: 3, length: 3 }]);
});

test("matches case-insensitively and respects internal spaces", () => {
	const buf = buffer([line([..."Run Foo Bar"].map((c) => cell(c)))]);
	assert.equal(scanBuffer(buf, "foo bar").length, 1);
	assert.equal(scanBuffer(buf, "FOO").length, 1);
	assert.equal(scanBuffer(buf, "baz").length, 0);
});

test("wide glyphs map to real cell columns, not JS string indices", () => {
	// a 你 b, where 你 occupies columns 1-2 and b sits at column 3.
	const cells = [cell("a"), cell("你", 2), cell("", 0), cell("b")];
	const buf = buffer([line(cells)]);

	const wide = scanBuffer(buf, "你");
	assert.equal(wide.length, 1);
	assert.deepEqual(wide[0].segments, [{ line: 0, start: 1, length: 2 }]);

	const after = scanBuffer(buf, "b");
	assert.equal(after.length, 1);
	assert.deepEqual(after[0].segments, [{ line: 0, start: 3, length: 1 }]);
});

test("searches across a soft-wrapped logical line and splits the match", () => {
	// "foobar" wrapped after the 3rd column.
	const first = line([..."foo"].map((c) => cell(c)));
	const second = line(
		[..."bar"].map((c) => cell(c)),
		true,
	);
	const buf = buffer([first, second]);

	const matches = scanBuffer(buf, "foobar", 3);
	assert.equal(matches.length, 1);
	assert.equal(matches[0].line, 0);
	assert.deepEqual(matches[0].segments, [
		{ line: 0, start: 0, length: 3 },
		{ line: 1, start: 0, length: 3 },
	]);
});

test("does not merge a hard newline into one match", () => {
	const first = line([..."foo"].map((c) => cell(c)));
	const second = line(
		[..."bar"].map((c) => cell(c)),
		false,
	);
	const buf = buffer([first, second]);
	assert.equal(scanBuffer(buf, "foobar").length, 0);
});

test("bounds lines by maxCols so stale resize cells are ignored", () => {
	const cells = [..."keep"].map((c) => cell(c));
	// Line array retained 8 cells after a shrink to 4 columns.
	cells.push(cell("x"), cell("x"), cell("x"), cell("x"));
	const buf = buffer([line(cells)]);
	assert.equal(scanBuffer(buf, "xxxx", 4).length, 0);
	assert.equal(scanBuffer(buf, "keep", 4).length, 1);
});
