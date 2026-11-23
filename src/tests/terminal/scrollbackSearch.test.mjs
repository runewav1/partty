import assert from "node:assert/strict";
import { test } from "node:test";
// biome-ignore lint/correctness/noUnresolvedImports: Node exposes this CommonJS package through a default export.
import xterm from "@xterm/xterm";
import {
	MAX_MATCH_PREVIEWS,
	scanScrollback,
} from "../../terminal/scrollbackSearch.ts";
import { mergeLifecyclePrefs } from "../../terminal/termLifecycle.ts";

function finish(scan) {
	let result = scan.next();
	while (!result.done) result = scan.next();
	return result.value;
}

test("quoted search includes the active TUI and capped normal history without scrolling", async (t) => {
	const term = new xterm.Terminal({
		cols: 8,
		rows: 3,
		scrollback: 1000,
		allowProposedApi: true,
	});
	t.after(() => term.dispose());
	await new Promise((done) =>
		term.write(
			[
				"ABC",
				"DEFG",
				"before abcdefg after",
				"\x1b[?1049h",
				"local abcdefg",
			].join("\r\n"),
			done,
		),
	);
	const viewport = term.buffer.normal.viewportY;
	const found = finish(scanScrollback(term, 100, "ABCDEFG"));
	assert.equal(found.count, 2);
	assert.deepEqual(
		found.matches.map(({ buffer, before, text, after }) => [
			buffer,
			before,
			text,
			after,
		]),
		[
			["alternate", "local ", "abcdefg", ""],
			["normal", "before ", "abcdefg", " after"],
		],
	);
	assert.equal(term.buffer.active.type, "alternate");
	assert.equal(term.buffer.normal.viewportY, viewport);
	assert.equal(term.hasSelection(), false);
	assert.deepEqual(
		finish(scanScrollback(term, 1, "abcdefg")).matches.map(
			(match) => match.buffer,
		),
		["alternate"],
	);
	await new Promise((done) => term.write("\x1b[?1049l", done));
	assert.deepEqual(
		finish(scanScrollback(term, 100, "abcdefg")).matches.map(
			(match) => match.buffer,
		),
		["normal"],
	);
});

test("scrollback counts all capped-window hits but stores only a bounded preview list", async (t) => {
	const term = new xterm.Terminal({
		cols: 12,
		rows: 3,
		scrollback: 1000,
		allowProposedApi: true,
	});
	t.after(() => term.dispose());
	await new Promise((done) =>
		term.write("zzZ.zzz\r\n".repeat(200) + "zzz", done),
	);
	const scan = scanScrollback(term, 150, "zzz");
	assert.equal(scan.next().done, false);
	const hits = finish(scan);
	assert.equal(hits.count, 299);
	assert.equal(hits.matches.length, MAX_MATCH_PREVIEWS);
	assert.equal(finish(scanScrollback(term, 150, "z.z")).count, 149);
	assert.equal(finish(scanScrollback(term, 0, "zzz")).count, 0);
});

test("scrollback search depth defaults to 2500 and is clamped to the configured history", () => {
	assert.equal(
		mergeLifecyclePrefs({ scrollback_lines: 5000 }).scrollback_search_lines,
		2500,
	);
	assert.equal(
		mergeLifecyclePrefs({
			scrollback_lines: 20000,
			scrollback_search_lines: 30000,
		}).scrollback_search_lines,
		20000,
	);
	assert.equal(
		mergeLifecyclePrefs({ scrollback_lines: 0 }).scrollback_search_lines,
		0,
	);
});
