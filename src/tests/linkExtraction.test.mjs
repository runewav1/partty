/**
 * Regression tests for terminal link extraction (src/util/linkExtraction.ts).
 *
 * The custom extractor no longer creates schemed http(s) links (the official
 * WebLinksAddon owns those); what remains is the narrow scheme-less fallback
 * (`www.`/localhost/loopback) plus path extraction. These tests pin the
 * boundary so a schemed URL is never re-detected as a URL or misread as a
 * drive path (`s://`).
 *
 * Run: node --experimental-strip-types --test src/tests/linkExtraction.test.mjs
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MODULE_URL = pathToFileURL(
	resolve(REPO, "src/util/linkExtraction.ts"),
).href;

const { findTerminalLinkMatches, normalizeExactExternalUrl } = await import(
	MODULE_URL
);

function urls(line, cwd = null) {
	return findTerminalLinkMatches(line, cwd).filter((m) => m.kind === "url");
}
function paths(line, cwd = null) {
	return findTerminalLinkMatches(line, cwd).filter((m) => m.kind === "path");
}

test("scheme-less www hosts are detected and normalized", () => {
	const [match] = urls("see www.example.com now");
	assert.ok(match);
	assert.equal(match.text, "www.example.com");
	assert.equal(match.value, "https://www.example.com/");
});

test("scheme-less localhost and loopback hosts are detected", () => {
	assert.equal(urls("open localhost:3000 please")[0]?.value, "https://localhost:3000/");
	assert.equal(
		urls("try 127.0.0.1:8080/health")[0]?.value,
		"https://127.0.0.1:8080/health",
	);
	assert.equal(urls("try [::1]:3000")[0]?.value, "https://[::1]:3000/");
});

test("scheme-less fallback never fires inside a schemed URL token", () => {
	assert.deepEqual(urls("go to https://www.example.com"), []);
	assert.deepEqual(urls("go to http://localhost:3000/x"), []);
	assert.deepEqual(urls("go to https://127.0.0.1:8080"), []);
});

test("schemed URLs are not misread as drive-letter paths", () => {
	// `s:/` in `https://` matches the drive alternative; it must be rejected.
	assert.deepEqual(paths("visit https://example.com/foo"), []);
	assert.deepEqual(paths("visit https://example.com/foo", "C:\\proj"), []);
	assert.deepEqual(paths("visit https://example.com/C:\\foo"), []);
});

test("absolute, quoted and relative paths survive", () => {
	const win = paths("open C:\\Users\\me\\file.txt");
	assert.equal(win.length, 1);
	assert.equal(win[0].value, "C:\\Users\\me\\file.txt");

	const quoted = paths('open "C:\\Program Files\\app.exe" now');
	assert.equal(quoted.length, 1);
	assert.equal(quoted[0].value, "C:\\Program Files\\app.exe");

	const relWin = paths("edit src/foo.ts", "C:\\proj");
	assert.equal(relWin.length, 1);
	assert.equal(relWin[0].value, "C:\\proj\\src\\foo.ts");

	const relWsl = paths("edit ./src/foo.ts", "/home/me/proj");
	assert.equal(relWsl.length, 1);
	assert.equal(relWsl[0].value, "/home/me/proj/src/foo.ts");
});

test("a scheme-less URL does not also produce an overlapping path", () => {
	const matches = findTerminalLinkMatches("see www.example.com/foo", "C:\\proj");
	assert.equal(matches.length, 1);
	assert.equal(matches[0].kind, "url");
});

test("scheme-less extraction trims trailing sentence punctuation", () => {
	const [match] = urls("see (www.example.com).");
	assert.ok(match);
	assert.equal(match.value, "https://www.example.com/");
});

test("exact normalization preserves balanced parentheses and query tails", () => {
	assert.equal(
		normalizeExactExternalUrl("https://example.com/wiki/Foo_(bar)"),
		"https://example.com/wiki/Foo_(bar)",
	);
	assert.equal(
		normalizeExactExternalUrl("https://example.com/a?b=(1)&c=2"),
		"https://example.com/a?b=(1)&c=2",
	);
	assert.equal(
		normalizeExactExternalUrl("localhost:3000"),
		"https://localhost:3000/",
	);
});

test("non-web schemes are rejected by exact normalization", () => {
	assert.equal(normalizeExactExternalUrl("javascript:alert(1)"), null);
	assert.equal(normalizeExactExternalUrl("ftp://example.com"), null);
	assert.equal(normalizeExactExternalUrl(""), null);
});

test("path heuristics reject prose, MIME types, dates, flags and URL fragments", () => {
	for (const text of ["yes/no", "and/or", "2026/09/12", "1/2", "text/plain", "application/json", "--output=src/main.ts", "/nologo", "feature/new-ui", "user@example.com/path", "https://host/srv/file", "//comment"]) {
		assert.deepEqual(paths(text, "/work"), [], text);
	}
});

test("quoted filenames stay exact and relative filenames resolve with spaces", () => {
	for (const [text, expected] of [
		['"/srv/my folder/a!.txt"', "/srv/my folder/a!.txt"],
		['"./my folder/a.txt"', "/work/my folder/a.txt"],
		['"/tmp/trailing."', "/tmp/trailing."],
		['"C:\\a folder\\file[1].txt"', "C:\\a folder\\file[1].txt"],
	]) {
		const [match] = paths(text, "/work");
		assert.equal(match?.value, expected);
		assert.equal(text.slice(match.start, match.end), match.text);
	}
});

test("diagnostic locations and prose wrappers are excluded from copied paths", () => {
	for (const text of ["(src/main.ts:12:3)", "src/main.ts(12,3)", "src/main.ts:12:", "[src/main.ts]"]) {
		const [match] = paths(text, "/work");
		assert.equal(match?.value, "/work/src/main.ts", text);
		assert.equal(text.slice(match.start, match.end), "src/main.ts");
	}
	assert.equal(paths("/tmp/file(foo)[1].txt")[0]?.value, "/tmp/file(foo)[1].txt");
	assert.equal(paths("/custom-root/nested/file")[0]?.value, "/custom-root/nested/file");
	assert.equal(paths("/srv/www.example.com")[0]?.value, "/srv/www.example.com");
	assert.deepEqual(paths("src/main.ts", null), []);
});
