import assert from "node:assert/strict";
import { test } from "node:test";
import { registerTerminalLinkProvider } from "../../terminal/linkProvider.ts";

function fixture(rows, cols, focused = false) {
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
				viewportY: 0,
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
	const controller = registerTerminalLinkProvider(term, {
		getCwd: () => "/project",
		isFocused: () => focused,
		activate() {},
	});
	return {
		controller,
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

function fakeScheduling(t) {
	let now = 0;
	let nextId = 1;
	const timers = new Map();
	const frames = new Map();
	const calls = { timerSets: 0, timerClears: 0, frameCancels: 0 };
	const saved = {
		window: globalThis.window,
		requestAnimationFrame: globalThis.requestAnimationFrame,
		cancelAnimationFrame: globalThis.cancelAnimationFrame,
	};
	t.mock.method(performance, "now", () => now);
	globalThis.window = {
		setTimeout(fn, delay) {
			calls.timerSets++;
			const id = nextId++;
			timers.set(id, { fn, due: now + delay });
			return id;
		},
		clearTimeout(id) {
			calls.timerClears++;
			timers.delete(id);
		},
	};
	globalThis.requestAnimationFrame = (fn) => {
		const id = nextId++;
		frames.set(id, fn);
		return id;
	};
	globalThis.cancelAnimationFrame = (id) => {
		calls.frameCancels++;
		frames.delete(id);
	};
	return {
		timers,
		frames,
		calls,
		advanceTo(time) {
			now = time;
			while (true) {
				const next = [...timers].find(([, timer]) => timer.due <= now);
				if (!next) break;
				timers.delete(next[0]);
				next[1].fn();
			}
		},
		flushFrames() {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const fn of callbacks) fn(now);
		},
		restore() {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete globalThis[key];
				else globalThis[key] = value;
			}
		},
	};
}

test("output bursts retain one timer and preserve the trailing debounce deadline", (t) => {
	const scheduling = fakeScheduling(t);
	const f = fixture([["/tmp/a.txt"]], 20, true);
	t.after(() => {
		f.controller.dispose();
		scheduling.restore();
	});
	for (let i = 0; i < 10_000; i++) f.invalidate();
	assert.equal(scheduling.calls.timerSets, 1);
	assert.equal(scheduling.calls.timerClears, 0);
	assert.equal(scheduling.timers.size, 1);
	assert.equal(
		f.links(1)[0].text,
		"/tmp/a.txt",
		"hover remains synchronous during output",
	);
	scheduling.advanceTo(60);
	f.invalidate();
	scheduling.advanceTo(75);
	assert.equal(scheduling.frames.size, 0);
	assert.equal(scheduling.calls.timerSets, 2);
	scheduling.advanceTo(135);
	assert.equal(scheduling.frames.size, 1);
	scheduling.flushFrames();
	assert.equal(scheduling.frames.size, 0);
	assert.equal(scheduling.timers.size, 0);
});

test("new output cancels pending prewarm and disposal clears the scheduler", (t) => {
	const scheduling = fakeScheduling(t);
	const f = fixture([["/tmp/a.txt"]], 20, true);
	t.after(() => {
		f.controller.dispose();
		scheduling.restore();
	});
	scheduling.advanceTo(75);
	assert.equal(scheduling.frames.size, 1);
	scheduling.advanceTo(76);
	f.invalidate();
	assert.equal(scheduling.frames.size, 0);
	assert.equal(scheduling.calls.frameCancels, 1);
	f.controller.dispose();
	assert.equal(scheduling.timers.size, 0);
	f.invalidate();
	assert.equal(scheduling.timers.size, 0);
});

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
