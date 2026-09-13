import assert from "node:assert/strict";
import { test } from "node:test";
import {
	expandRelativePath,
	quotePath,
	translatePasteText,
	translatePathFromSource,
} from "../util/paths.ts";

test("relative traversal preserves filesystem roots", () => {
	for (const [cwd, expected] of [
		["C:\\work", "C:\\file.txt"],
		["\\\\server\\share\\work", "\\\\server\\share\\file.txt"],
		["//server/share/work", "\\\\server\\share\\file.txt"],
		["\\\\?\\UNC\\server\\share\\work", "\\\\server\\share\\file.txt"],
		["\\\\?\\C:\\work", "C:\\file.txt"],
		["/home/me", "/file.txt"],
	])
		assert.equal(expandRelativePath("../../../file.txt", cwd), expected);
	assert.equal(expandRelativePath("..", "C:\\work"), "C:\\");
	assert.equal(
		expandRelativePath("./a\\b.txt", "/home/me", "posix"),
		"/home/me/a\\b.txt",
	);
});

test("paste and editor translation use the source terminal's path style", () => {
	for (const [raw, source, target, expected] of [
		["/mnt/c/work/a.txt", "wsl", "windows", "C:\\work\\a.txt"],
		["/mnt/c", "wsl", "windows", "C:\\"],
		["/c/work/a.txt", "msys", "windows", "C:\\work\\a.txt"],
		["/c", "msys", "wsl", "/mnt/c/"],
		["/mnt/c/work", "wsl", "msys", "/c/work"],
		["/mnt/c/work", "posix", "windows", "/mnt/c/work"],
		["/c/work", "posix", "wsl", "/c/work"],
		["/home/a\\b", "posix", "posix", "/home/a\\b"],
		["C:\\work", "windows", "wsl", "/mnt/c/work"],
		["\\\\WSL.LOCALHOST\\Ubuntu", "windows", "wsl", "/"],
	]) {
		const cwd = source === "msys" ? "/c/work" : "/home/me";
		assert.equal(translatePathFromSource(raw, target, cwd, source), expected);
		assert.equal(
			translatePasteText(raw, target, { style: source, cwd }),
			quotePath(expected, target),
		);
	}
	assert.equal(
		translatePasteText("/home/me/a", "windows", {
			style: "wsl",
			cwd: "\\\\wsl$\\Ubuntu",
		}),
		"\\\\wsl$\\Ubuntu\\home\\me\\a",
	);
});

test("POSIX quoting protects shell syntax and preserves home expansion", () => {
	for (const path of [
		"/tmp/a;b",
		"/tmp/a&b",
		"/tmp/a(b)",
		"/tmp/[ab]*",
		"/tmp/a#b",
	]) {
		assert.equal(quotePath(path, "posix"), `'${path}'`);
	}
	assert.equal(quotePath("~/my files/a'b", "wsl"), "~/'my files/a'\\''b'");
	assert.equal(
		translatePasteText("ordinary text\n/another line", "wsl"),
		"ordinary text\n/another line",
	);
});
