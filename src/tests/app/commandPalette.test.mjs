/**
 * Behavioral tests for the command palette controller (src/app/commandPalette.ts).
 *
 * Peripherals (motion / cursor / overlay stack) are stub modules loaded through
 * a VM loader (same SourceTextModule pattern as the perf suite), so the palette
 * runs in isolation. Each test gets a fresh VM and disposes its palette via
 * `t.after`, so module state, timers and the overlay stack never leak.
 *
 * Run: node --experimental-vm-modules --experimental-strip-types --test src/tests/app/commandPalette.test.mjs
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { FakeElement, FakeFragment } from "../support/dom.mjs";
import { createVmLoader } from "../support/vm.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const LEXICAL_URL = pathToFileURL(resolve(ROOT, "util/lexicalSearch.ts")).href;

const { filterAndRankLexical, normalizeQuery } = await import(LEXICAL_URL);

// --- Module stubs: keep the controller's DOM surface to createElement only. ---

const STUBS = new Map([
	[
		resolve(ROOT, "util/motion.ts"),
		`export function showSurface(el, hiddenClass) {
			el.classList.remove(hiddenClass);
		}
		export function hideSurface(el, hiddenClass, onHidden) {
			el.classList.add(hiddenClass);
			if (onHidden) onHidden();
		}`,
	],
	[
		resolve(ROOT, "app/mouseCursor.ts"),
		`export function mouseCursorForceVisible() {}`,
	],
	[
		resolve(ROOT, "app/overlayStack.ts"),
		`const stack = [];
		export function pushOverlay(close) {
			const entry = { close };
			stack.push(entry);
			return {
				release() {
					const i = stack.indexOf(entry);
					if (i !== -1) stack.splice(i, 1);
				},
			};
		}`,
	],
]);

// The DOM fixtures and VM loader live in ../support/ (shared with other suites).

/** Compile the controller once per test with isolated state and stubbed peers. */
async function createEnv() {
	const state = {
		createCount: 0,
		intervals: new Map(),
		rafs: new Map(),
		id: 0,
	};
	const documentStub = {
		createElement: (tag) => {
			state.createCount += 1;
			return new FakeElement(tag);
		},
		createDocumentFragment: () => new FakeFragment(),
	};
	const windowStub = {
		setInterval: (fn) => {
			const id = ++state.id;
			state.intervals.set(id, fn);
			return id;
		},
		clearInterval: (id) => state.intervals.delete(id),
	};
	const loader = createVmLoader({
		root: ROOT,
		globals: {
			document: documentStub,
			window: windowStub,
			requestAnimationFrame: (fn) => {
				const id = ++state.id;
				state.rafs.set(id, fn);
				return id;
			},
			cancelAnimationFrame: (id) => state.rafs.delete(id),
		},
		stubs: STUBS,
	});
	const entry = await loader.api("app/commandPalette.ts");

	return {
		createCommandPalette: entry.createCommandPalette,
		document: documentStub,
		get createCount() {
			return state.createCount;
		},
		resetCreateCount() {
			state.createCount = 0;
		},
		advanceRaf() {
			const pending = [...state.rafs.values()];
			state.rafs.clear();
			for (const fn of pending) fn(0);
		},
		tickIntervals() {
			for (const fn of [...state.intervals.values()]) fn();
		},
	};
}

function fire(el, type, event = {}) {
	for (const fn of [...(el.listeners.get(type) ?? [])]) fn(event);
}

function key(value, extra = {}) {
	return {
		key: value,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		shiftKey: false,
		isComposing: false,
		preventDefault() {},
		stopPropagation() {},
		...extra,
	};
}

function mouseEvent() {
	return { preventDefault() {}, stopPropagation() {}, target: null };
}

function makeHarness(env, options) {
	const root = env.document.createElement("div");
	root.className = "command-palette command-palette--hidden";
	const input = env.document.createElement("input");
	const list = env.document.createElement("ul");
	root.appendChild(input);
	root.appendChild(list);

	let replaceCount = 0;
	const originalReplace = list.replaceChildren.bind(list);
	list.replaceChildren = (...args) => {
		replaceCount += 1;
		return originalReplace(...args);
	};

	let getCalls = 0;
	const api = env.createCommandPalette({
		root,
		input,
		list,
		getCommands: () => {
			getCalls += 1;
			return options.commands();
		},
		onClosed: options.onClosed,
		onTabComplete: options.onTabComplete,
		onQuickSelectKey: options.onQuickSelectKey,
		refreshMs: options.refreshMs,
	});

	return {
		env,
		api,
		input,
		list,
		getCalls: () => getCalls,
		replaceCount: () => replaceCount,
		rows: () => list.children,
		activeIndex: () =>
			list.children.findIndex((li) =>
				li.classList.contains("command-palette-item--active"),
			),
		labels: () =>
			list.children.map((li) => li.children[0].children[0].textContent),
	};
}

/** Fresh env + harness per test; disposes the palette afterwards. */
async function setup(t, options) {
	const env = await createEnv();
	const harness = makeHarness(env, options);
	t.after(() => harness.api.dispose());
	harness.api.open();
	await Promise.resolve();
	await Promise.resolve();
	harness.env.advanceRaf();
	return harness;
}

function findRemoveButton(li) {
	return (
		li.children[0].children.find((child) =>
			child.classList.contains("command-palette-item-remove"),
		) ?? null
	);
}

test("input is batched into one render per animation frame", async (t) => {
	const commands = [
		{ id: "a", label: "Alpha", keywords: "first" },
		{ id: "b", label: "Beta", keywords: "second" },
		{ id: "c", label: "Gamma", keywords: "third" },
	];
	const h = await setup(t, { commands: () => commands });
	const before = h.replaceCount();

	h.input.value = "a";
	fire(h.input, "input");
	h.input.value = "al";
	fire(h.input, "input");
	h.input.value = "alp";
	fire(h.input, "input");
	assert.equal(h.replaceCount(), before, "no intermediate rebuilds");

	h.env.advanceRaf();
	assert.equal(h.replaceCount(), before + 1, "one rebuild for the burst");
	assert.deepEqual(
		h.labels(),
		filterAndRankLexical(commands, normalizeQuery("alp")).map((c) => c.label),
		"the rendered row order matches the shared ranker",
	);
});

test("arrow keys wrap the selection and Enter runs it exactly once", async (t) => {
	const ran = [];
	let closed = 0;
	const commands = [
		{ id: "a", label: "A", run: () => ran.push("a") },
		{ id: "b", label: "B", run: () => ran.push("b") },
		{ id: "c", label: "C", run: () => ran.push("c") },
	];
	const h = await setup(t, {
		commands: () => commands,
		onClosed: () => {
			closed += 1;
		},
	});
	assert.equal(h.activeIndex(), 0);

	fire(h.input, "keydown", key("ArrowUp"));
	assert.equal(h.activeIndex(), 2, "ArrowUp wraps to the last row");
	fire(h.input, "keydown", key("ArrowDown"));
	assert.equal(h.activeIndex(), 0, "ArrowDown wraps to the first row");
	fire(h.input, "keydown", key("ArrowDown"));
	assert.equal(h.activeIndex(), 1);

	fire(h.input, "keydown", key("Enter"));
	await Promise.resolve();
	assert.deepEqual(ran, ["b"]);
	assert.equal(h.api.isOpen(), false);
	assert.equal(closed, 1, "onClosed fires once after a run");
});

test("timer refresh before a pending input filter keeps the active class correct", async (t) => {
	// Regression: resetting the selection via input and then letting the
	// interval run with an unchanged row signature must not leave the old row
	// highlighted while the input's filter frame is still pending.
	const commands = [
		{ id: "a", label: "A" },
		{ id: "b", label: "B" },
		{ id: "c", label: "C" },
	];
	const h = await setup(t, { commands: () => commands, refreshMs: 500 });
	fire(h.input, "keydown", key("ArrowDown"));
	fire(h.input, "keydown", key("ArrowDown"));
	assert.equal(h.activeIndex(), 2);

	fire(h.input, "input");
	h.env.tickIntervals();
	assert.equal(h.activeIndex(), 0, "active class follows the reset selection");

	h.env.advanceRaf();
	assert.equal(h.activeIndex(), 0);
});

test("Tab completion and alias quick-select route through host callbacks", async (t) => {
	const tabCalls = [];
	let ranQuick = null;
	const commands = [
		{ id: "tab-new", label: "New tab" },
		{ id: "split", label: "Split" },
	];
	const h = await setup(t, {
		commands: () => commands,
		onTabComplete: (current, selected) => {
			tabCalls.push({ current, id: selected?.id ?? null });
			return "@pane:p1 ";
		},
		onQuickSelectKey: (value) =>
			value === "z"
				? {
						id: "profile",
						label: "Zed",
						run: () => {
							ranQuick = "zed";
						},
					}
				: null,
	});

	fire(h.input, "keydown", key("Tab"));
	assert.deepEqual(tabCalls, [{ current: "", id: "tab-new" }]);
	assert.equal(h.input.value, "@pane:p1 ");
	h.env.advanceRaf();

	fire(h.input, "keydown", key("z"));
	await Promise.resolve();
	assert.equal(ranQuick, "zed");
});

test("closing clears the rows and reopening rebuilds them", async (t) => {
	const commands = [
		{ id: "a", label: "A" },
		{ id: "b", label: "B" },
	];
	const h = await setup(t, { commands: () => commands });
	assert.equal(h.rows().length, 2);

	h.api.close();
	assert.equal(h.rows().length, 0, "close clears the list");

	// Reopen through the public API, not a bare applyFilter call.
	h.api.open();
	await Promise.resolve();
	await Promise.resolve();
	h.env.advanceRaf();
	assert.equal(h.rows().length, 2, "reopen rebuilds the rows");
});

test("reused rows execute the newest remove callback", async (t) => {
	const removals = [];
	let generation = 0;
	const h = await setup(t, {
		commands: () => {
			const mine = ++generation;
			return [
				{
					id: "a",
					label: "A",
					removeLabel: "Remove A",
					remove: () => removals.push(mine),
				},
			];
		},
		refreshMs: 500,
	});
	assert.equal(generation, 1);

	const button = findRemoveButton(h.rows()[0]);
	assert.ok(button, "remove button exists");
	const before = h.replaceCount();
	h.env.tickIntervals();
	assert.equal(generation, 2, "the interval refetches commands");
	assert.equal(h.replaceCount(), before, "unchanged rows are reused");

	// The button was built from generation 1; it must resolve generation 2.
	fire(button, "click", mouseEvent());
	await Promise.resolve();
	assert.deepEqual(removals, [2]);
});

test("a changed run reference applies without rebuilding rows", async (t) => {
	let ranTag = null;
	let currentRun = () => {
		ranTag = "old";
	};
	const h = await setup(t, {
		commands: () => [{ id: "a", label: "A", run: currentRun }],
		refreshMs: 500,
	});
	const before = h.replaceCount();

	currentRun = () => {
		ranTag = "new";
	};
	h.env.tickIntervals();
	assert.equal(h.replaceCount(), before, "run-only change does not rebuild");

	fire(h.input, "keydown", key("Enter"));
	await Promise.resolve();
	assert.equal(ranTag, "new", "Enter uses the newest run reference");
});

const FIELD_CASES = [
	{
		name: "label",
		initial: [{ id: "a", label: "A" }],
		mutate: (rows) => {
			rows[0].label = "B";
		},
		labels: ["B"],
	},
	{
		name: "labelHtml",
		initial: [{ id: "a", label: "A" }],
		mutate: (rows) => {
			rows[0].labelHtml = "<b>A</b>";
		},
		labels: [""],
	},
	{
		name: "hotkey",
		initial: [{ id: "a", label: "A" }],
		mutate: (rows) => {
			rows[0].hotkey = "Ctrl+K";
		},
		labels: ["A"],
	},
	{
		name: "remove presence",
		initial: [{ id: "a", label: "A" }],
		mutate: (rows) => {
			rows[0].remove = () => {};
		},
		labels: ["A"],
	},
	{
		name: "removeLabel",
		initial: [{ id: "a", label: "A", remove: () => {}, removeLabel: "X" }],
		mutate: (rows) => {
			rows[0].removeLabel = "Y";
		},
		labels: ["A"],
	},
	{
		name: "id",
		initial: [{ id: "a", label: "A" }],
		mutate: (rows) => {
			rows[0].id = "b";
		},
		labels: ["A"],
	},
	{
		name: "order",
		initial: [
			{ id: "a", label: "A" },
			{ id: "b", label: "B" },
		],
		mutate: (rows) => {
			rows.reverse();
		},
		labels: ["B", "A"],
	},
	{
		name: "delimiter-bearing fields",
		initial: [{ id: "a", label: "b|c" }],
		mutate: (rows) => {
			rows[0].id = "a|b";
			rows[0].label = "c";
		},
		labels: ["c"],
	},
];

for (const testCase of FIELD_CASES) {
	test(`interval refresh rebuilds when ${testCase.name} changes`, async (t) => {
		const rows = testCase.initial.map((row) => ({ ...row }));
		const h = await setup(t, { commands: () => rows, refreshMs: 500 });
		const before = h.replaceCount();

		h.env.tickIntervals();
		assert.equal(h.replaceCount(), before, "identical rows are reused");

		testCase.mutate(rows);
		h.env.tickIntervals();
		assert.equal(h.replaceCount(), before + 1, "the field change rebuilds");
		assert.deepEqual(h.labels(), testCase.labels);
	});
}

test("idle interval refreshes skip row construction but keep fetching commands", async (t) => {
	const commands = Array.from({ length: 6 }, (_, i) => ({
		id: `c${i}`,
		label: `Command ${i}`,
		keywords: `cmd ${i}`,
	}));
	const h = await setup(t, { commands: () => commands, refreshMs: 500 });

	// Baseline: one forced (non-deduped) rebuild creates 3 nodes per row.
	h.env.resetCreateCount();
	fire(h.input, "input");
	h.env.advanceRaf();
	assert.equal(
		h.env.createCount,
		commands.length * 3,
		"one full render creates 3 nodes per row",
	);

	// Optimized: idle interval ticks fetch fresh commands but create nothing.
	const before = h.replaceCount();
	const gets = h.getCalls();
	h.env.resetCreateCount();
	for (let i = 0; i < 6; i += 1) h.env.tickIntervals();
	assert.equal(h.replaceCount(), before, "no rebuilds across 6 idle ticks");
	assert.equal(h.env.createCount, 0, "zero row nodes created while idle");
	assert.equal(h.getCalls(), gets + 6, "commands still fetched every tick");
});
