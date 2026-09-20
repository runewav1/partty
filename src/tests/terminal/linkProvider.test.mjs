import assert from "node:assert/strict";
import { test } from "node:test";
import { registerTerminalLinkProvider } from "../../terminal/linkProvider.ts";

function fixture(rows, cols) {
	let provider;
	let invalidate;
	const lines = rows.map(([text, isWrapped = false]) => ({
		isWrapped,
		length: cols,
		translateToString: () => text.trimEnd(),
		getCell(x, target = {}) {
			const value = text[x] ?? "";
			target.getWidth = () => 1;
			target.getChars = () => value;
			return target;
		},
	}));
	const disposable = () => ({ dispose() {} });
	const term = {
		cols,
		rows: rows.length,
		buffer: {
			active: {
				length: rows.length,
				getLine: (y) => lines[y],
				getNullCell: () => ({}),
			},
			onBufferChange: disposable,
		},
		registerLinkProvider(value) {
			provider = value;
			return disposable();
		},
		onWriteParsed(fn) {
			invalidate = fn;
			return disposable();
		},
		onScroll: disposable,
		onResize: disposable,
	};
	registerTerminalLinkProvider(term, {
		getCwd: () => "/project",
		isFocused: () => false,
		activate() {},
	});
	return {
		lines,
		invalidate: () => invalidate(),
		links(y) {
			let result;
			provider.provideLinks(y, (links) => {
				result = links ?? [];
			});
			return result;
		},
	};
}

test("wrapped paths have exact inclusive cell ranges", () => {
	const f = fixture([["/tmp/abcde"], ["file.txt", true]], 10);
	assert.deepEqual(f.links(2)[0].range, {
		start: { x: 1, y: 1 },
		end: { x: 8, y: 2 },
	});
});

test("quoted TUI padding cannot become a screen-wide path", () => {
	const f = fixture(
		[['"/tmp/'], ["panel one", true], ["panel two", true], ['end"', true]],
		40,
	);
	for (let y = 1; y <= 4; y++) {
		for (const link of f.links(y)) {
			assert.equal(link.text, "/tmp/");
			assert.equal(link.range.start.y, link.range.end.y);
		}
	}
});

test("a neighbouring row scan does not poison another row's cache", () => {
	const f = fixture(
		[["header    "], ["/tmp/abcde", true], ["file.txt  ", true]],
		10,
	);
	f.links(1);
	assert.equal(f.links(3)[0]?.text, "/tmp/abcdefile.txt");
});

test("write invalidation discards stale path ranges", () => {
	const f = fixture([["/tmp/a.txt"]], 20);
	assert.equal(f.links(1).length, 1);
	f.lines[0].getCell = (_x, target = {}) => {
		target.getWidth = () => 1;
		target.getChars = () => "";
		return target;
	};
	f.invalidate();
	assert.deepEqual(f.links(1), []);
});

test("early-wrapped wide characters do not introduce a false space", () => {
	const f = fixture([["/tmp/"], ["界.txt", true]], 6);
	f.lines[1].getCell = (x, target = {}) => {
		target.getWidth = () => (x === 0 ? 2 : x === 1 ? 0 : 1);
		target.getChars = () => ["界", "", ".", "t", "x", "t"][x];
		return target;
	};
	assert.equal(f.links(2)[0]?.text, "/tmp/界.txt");
	assert.deepEqual(f.links(2)[0].range.end, { x: 6, y: 2 });
});
