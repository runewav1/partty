/**
 * Behavioral tests for the command palette controller (src/app/commandPalette.ts).
 *
 * Peripherals (motion / cursor / overlay stack) are stub modules loaded through
 * a VM loader (SourceTextModule), so the palette
 * runs in isolation. Each test gets a fresh VM and disposes its palette via
 * `t.after`, so module state, timers and the overlay stack never leak.
 *
 * Run: node --experimental-vm-modules --disable-warning=ExperimentalWarning --test src/tests/app/commandPalette.test.mjs
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
		errors: [],
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
			console: {
				error: (...args) => state.errors.push(args),
			},
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
		errors: () => state.errors,
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
		getFilteredCommands: options.getFilteredCommands,
		filteredEmptyText: options.filteredEmptyText,
		onClosed: options.onClosed,
		onBeforeOpen: options.onBeforeOpen,
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

/** Drain the microtask chains started by fire-and-forget palette actions. */
async function flushAsync() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

test("progress rings update and clear without replacing palette rows", async (t) => {
	let progress = null;
	const h = await setup(t, {
		commands: () => [
			{ id: "pane", label: "Pane", progress },
			{ id: "proc", label: "Process", progress },
			{ id: "action", label: "Action" },
		],
		refreshMs: 500,
	});
	const [pane, proc, action] = h.rows();
	const rings = [pane, proc].map((row) => row.querySelector(".progress-ring"));
	assert.ok(rings.every((ring) => ring.hidden));
	assert.equal(action.querySelector(".progress-ring"), null);
	fire(h.input, "keydown", key("ArrowDown"));
	const active = h.list.getAttribute("aria-activedescendant");
	const renderCount = h.replaceCount();

	for (const [state, value, description] of [
		["normal", 0, "0% complete"],
		["normal", 65, "65% complete"],
		["indeterminate", 65, "In progress"],
		["paused", 65, "Paused at 65%"],
		["error", 65, "Error at 65%"],
		["clear", 0, null],
	]) {
		progress = { state, value };
		h.env.tickIntervals();
		for (const [index, ring] of rings.entries()) {
			assert.equal(ring.hidden, state === "clear");
			assert.equal(ring.dataset.state, state);
			assert.equal(
				ring.getAttribute("style"),
				state === "indeterminate" ? null : `--progress-fill: ${value}%`,
			);
			assert.equal(
				h.rows()[index].getAttribute("aria-description"),
				description,
			);
		}
		assert.equal(h.replaceCount(), renderCount);
		assert.equal(h.list.getAttribute("aria-activedescendant"), active);
	}
});

test("prefiltered workspace rows keep their order and update status in place", async (t) => {
	let elapsed = "6s";
	let picked = "";
	const h = await setup(t, {
		commands: () => [],
		getFilteredCommands: (query) => {
			if (query === ":miss") return [];
			const tab = {
				id: "tab",
				label: "Tools",
				appearance: "workspace-tab",
				run: () => {
					picked = "tab";
				},
			};
			if (query === ":tools") return [tab];
			if (query !== ":build") return undefined;
			return [
				{
					id: "pane",
					label: "build",
					appearance: "workspace-remote",
					status: elapsed,
					run: () => {
						picked = "pane";
					},
				},
				tab,
			];
		},
		filteredEmptyText: "No matching tabs or panes",
		refreshMs: 500,
	});
	h.input.value = ":miss";
	fire(h.input, "input");
	h.env.advanceRaf();
	assert.equal(h.list.getAttribute("aria-activedescendant"), null);
	assert.equal(h.rows()[0].textContent, "No matching tabs or panes");

	h.input.value = ":build";
	fire(h.input, "input");
	h.env.advanceRaf();
	assert.deepEqual(h.labels(), ["build", "Tools"]);
	assert.equal(
		h.list.getAttribute("aria-activedescendant"),
		"palette-opt-pane",
	);
	const pane = h.rows()[0];
	const status = pane.querySelector(".command-palette-item-status");
	assert.equal(status.textContent, "6s");
	elapsed = "7s";
	h.env.tickIntervals();
	assert.equal(h.rows()[0], pane);
	assert.equal(status.textContent, "7s");

	h.input.value = ":tools";
	fire(h.input, "input");
	h.env.advanceRaf();
	assert.deepEqual(h.labels(), ["Tools"]);
	h.input.value = ":build";
	fire(h.input, "input");
	fire(h.input, "keydown", key("Enter"));
	assert.equal(picked, "pane");
});

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

test("Tab expands one result without replacing the query or moving selection", async (t) => {
	let expanded = false;
	const h = await setup(t, {
		commands: () => [
			{ id: "tab", label: "Tab" },
			{
				id: "pane",
				label: "Pane",
				onTab: () => {
					expanded = !expanded;
				},
			},
			...(expanded ? [{ id: "match", label: "Match" }] : []),
		],
	});
	fire(h.input, "keydown", key("ArrowDown"));
	fire(h.input, "keydown", key("Tab"));
	assert.equal(h.input.value, "");
	assert.equal(h.rows().length, 3);
	assert.equal(
		h.rows()[1].classList.contains("command-palette-item--active"),
		true,
	);
	fire(h.input, "keydown", key("Tab"));
	assert.equal(h.rows().length, 2);
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

test("refresh reflects command changes while keeping unchanged rows", async (t) => {
	const command = { id: "a", label: "b|c" };
	const rows = [command, { id: "other", label: "Other" }];
	const h = await setup(t, { commands: () => rows, refreshMs: 500 });
	const current = () => h.rows()[rows.indexOf(command)];
	const label = () => current().children[0].children[0];
	const original = current();
	h.env.tickIntervals();
	assert.equal(current(), original);

	// This update must not collide with the original ID + label.
	Object.assign(command, { id: "a|b", label: "c" });
	h.env.tickIntervals();
	assert.deepEqual(h.labels(), ["c", "Other"]);

	command.label = "Renamed";
	h.env.tickIntervals();
	assert.equal(label().textContent, "Renamed");

	command.id = "renamed-command";
	h.env.tickIntervals();
	assert.equal(current().id, "palette-opt-renamed-command");

	command.labelHtml = "<b>Renamed</b>";
	h.env.tickIntervals();
	assert.equal(label().innerHTML, "<b>Renamed</b>");

	command.hotkey = "Ctrl+K";
	h.env.tickIntervals();
	assert.ok(
		current().children[0].children.some(
			(child) => child.textContent === "Ctrl+K",
		),
	);

	command.remove = () => {};
	h.env.tickIntervals();
	assert.ok(findRemoveButton(current()));

	command.removeLabel = "Remove saved command";
	h.env.tickIntervals();
	assert.equal(
		findRemoveButton(current()).getAttribute("aria-label"),
		"Remove saved command",
	);

	rows.reverse();
	h.env.tickIntervals();
	assert.equal(h.labels()[0], "Other");
	assert.equal(label().innerHTML, "<b>Renamed</b>");
});

test("idle interval refreshes skip row construction but keep fetching commands", async (t) => {
	const commands = Array.from({ length: 6 }, (_, i) => ({
		id: `c${i}`,
		label: `Command ${i}`,
		keywords: `cmd ${i}`,
	}));
	const h = await setup(t, { commands: () => commands, refreshMs: 500 });

	// Idle ticks must keep the data fresh without allocating replacement rows.
	const before = h.replaceCount();
	const gets = h.getCalls();
	h.env.resetCreateCount();
	for (let i = 0; i < 6; i += 1) h.env.tickIntervals();
	assert.equal(h.replaceCount(), before, "no rebuilds across 6 idle ticks");
	assert.equal(h.env.createCount, 0, "zero row nodes created while idle");
	assert.equal(h.getCalls(), gets + 6, "commands still fetched every tick");
});

test("a rejected command run closes the palette and reopening still works", async (t) => {
	let mode = "reject";
	let closed = 0;
	const runs = [];
	const commands = [
		{
			id: "fail",
			label: "Fail",
			run: () => {
				runs.push(mode);
				if (mode === "throw") throw new Error("sync run");
				if (mode === "reject") return Promise.reject(new Error("async run"));
			},
		},
	];
	const h = await setup(t, {
		commands: () => commands,
		onClosed: () => {
			closed += 1;
		},
	});

	fire(h.input, "keydown", key("Enter"));
	await flushAsync();
	assert.deepEqual(runs, ["reject"]);
	assert.equal(h.api.isOpen(), false);
	assert.equal(closed, 1, "onClosed still fires when the command rejects");
	assert.equal(h.env.errors().length, 1, "the rejection is reported");

	// A synchronous throw follows the same handled path.
	mode = "throw";
	h.api.open();
	await flushAsync();
	h.env.advanceRaf();
	fire(h.input, "keydown", key("Enter"));
	await flushAsync();
	assert.deepEqual(runs, ["reject", "throw"]);
	assert.equal(closed, 2);
	assert.equal(h.env.errors().length, 2);

	// Reopening after failures rebuilds the rows and a success closes normally.
	mode = "ok";
	h.api.open();
	await flushAsync();
	h.env.advanceRaf();
	assert.equal(h.api.isOpen(), true);
	assert.equal(h.rows().length, 1, "reopen rebuilds the list");
	fire(h.input, "keydown", key("Enter"));
	await flushAsync();
	assert.equal(closed, 3);
	assert.equal(h.env.errors().length, 2, "a successful run adds no error");
});

test("remove failures are reported and the list still refreshes", async (t) => {
	let mode = "sync-throw";
	const calls = [];
	const commands = [
		{
			id: "a",
			label: "A",
			removeLabel: "Remove A",
			remove: () => {
				calls.push(mode);
				if (mode === "sync-throw") throw new Error("sync remove");
				if (mode === "reject") return Promise.reject(new Error("async remove"));
			},
		},
	];
	const h = await setup(t, { commands: () => commands });
	const clickRemove = () =>
		fire(findRemoveButton(h.rows()[0]), "click", mouseEvent());

	const before = h.replaceCount();
	clickRemove();
	await flushAsync();
	assert.deepEqual(calls, ["sync-throw"]);
	assert.equal(h.env.errors().length, 1);
	assert.equal(
		h.replaceCount(),
		before + 1,
		"list refreshes after the failure",
	);
	assert.equal(h.rows().length, 1);

	mode = "reject";
	clickRemove();
	await flushAsync();
	assert.deepEqual(calls, ["sync-throw", "reject"]);
	assert.equal(h.env.errors().length, 2);
	assert.equal(h.rows().length, 1);

	mode = "ok";
	clickRemove();
	await flushAsync();
	assert.deepEqual(calls, ["sync-throw", "reject", "ok"]);
	assert.equal(h.env.errors().length, 2, "a successful remove adds no error");
});

test("onBeforeOpen failures reset opening so the palette can be retried", async (t) => {
	let attempts = 0;
	const h = await setup(t, {
		commands: () => [{ id: "a", label: "A" }],
		onBeforeOpen: () => {
			attempts += 1;
			if (attempts === 1) throw new Error("sync preload");
			if (attempts === 2) return Promise.reject(new Error("async preload"));
		},
	});

	assert.equal(attempts, 1);
	assert.equal(h.api.isOpen(), false, "a failed preload does not open");
	assert.equal(h.env.errors().length, 1);

	h.api.open();
	await flushAsync();
	assert.equal(attempts, 2);
	assert.equal(h.api.isOpen(), false, "a rejected preload does not open");
	assert.equal(h.env.errors().length, 2);

	h.api.open();
	await flushAsync();
	h.env.advanceRaf();
	assert.equal(attempts, 3, "the third attempt runs after the failures");
	assert.equal(h.api.isOpen(), true, "a successful retry opens");
	assert.equal(h.rows().length, 1, "the retry renders the rows");
	assert.equal(h.env.errors().length, 2);
});
