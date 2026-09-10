/**
 * Lifecycle regression tests for the shared command island host.
 *
 * The island coordinates mutually-exclusive surfaces (palette, settings, help,
 * theme, find) without a DOM dependency, so the coordinator contract can be
 * exercised directly: adopt once, present makes one view active, switching
 * closes the previous view, and dismissing the active view hides the host only
 * once nothing is open.
 *
 * Run: node --experimental-strip-types --test src/tests/commandIsland.test.mjs
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MODULE_URL = pathToFileURL(
	resolve(REPO, "src/app/commandIsland.ts"),
).href;

const { createCommandIsland } = await import(MODULE_URL);

class FakeClassList {
	#set = new Set();
	add(...names) {
		for (const n of names) this.#set.add(n);
	}
	remove(...names) {
		for (const n of names) this.#set.delete(n);
	}
	contains(name) {
		return this.#set.has(name);
	}
}

class FakeEl {
	constructor() {
		this.children = [];
		this.parentElement = null;
		this.classList = new FakeClassList();
		this.dataset = {};
		this.attrs = new Map();
	}
	append(child) {
		if (child.parentElement) {
			child.parentElement.children = child.parentElement.children.filter(
				(c) => c !== child,
			);
		}
		child.parentElement = this;
		this.children.push(child);
	}
	setAttribute(name, value) {
		this.attrs.set(name, String(value));
	}
	getAttribute(name) {
		return this.attrs.has(name) ? this.attrs.get(name) : null;
	}
}

function makeHarness() {
	const host = new FakeEl();
	const island = createCommandIsland(host);
	const closed = [];
	const state = new Map();
	const views = {};
	for (const id of ["a", "b", "c"]) {
		const s = { open: false };
		state.set(id, s);
		views[id] = {
			id,
			element: new FakeEl(),
			hiddenClass: `${id}--hidden`,
			isOpen: () => s.open,
			close: () => {
				if (!s.open) return;
				s.open = false;
				closed.push(id);
				island.dismiss(id);
			},
		};
		island.adopt(views[id]);
	}
	const open = (id) => {
		state.get(id).open = true;
		island.present(id);
	};
	return { host, island, views, state, open, closed };
}

test("adopt moves each view into the host and tags it", () => {
	const { host, views } = makeHarness();
	for (const id of ["a", "b", "c"]) {
		assert.equal(views[id].element.parentElement, host);
		assert.ok(views[id].element.classList.contains("command-island-view"));
		assert.equal(views[id].element.dataset.islandView, id);
	}
});

test("present makes one view active and closes the previous one", () => {
	const { island, host, open, closed } = makeHarness();
	open("a");
	assert.equal(island.activeId(), "a");
	assert.equal(host.getAttribute("aria-hidden"), "false");
	assert.ok(host.classList.contains("command-island--active"));

	open("b");
	assert.equal(island.activeId(), "b");
	assert.deepEqual(closed, ["a"], "opening b must close a");
	assert.equal(island.isActive("a"), false);
	assert.equal(island.isActive("b"), true);
	assert.equal(host.getAttribute("aria-hidden"), "false");
});

test("present of the already-active view is a no-op", () => {
	const { island, open, closed } = makeHarness();
	open("a");
	open("a");
	assert.equal(island.activeId(), "a");
	assert.deepEqual(closed, [], "re-presenting a must not close it");
});

test("dismiss hides the host immediately even when a view's open state lags", () => {
	// Help panels report isOpen() from a class that hideSurface removes only
	// after the exit animation, so dismiss must not wait on view.isOpen().
	const { island, host, open } = makeHarness();
	open("a");
	open("b");
	island.dismiss("b");
	assert.equal(island.activeId(), null);
	assert.equal(host.getAttribute("aria-hidden"), "true");
	assert.equal(host.classList.contains("command-island--active"), false);
});

test("dismiss ignores non-active ids", () => {
	const { island, open } = makeHarness();
	open("a");
	island.dismiss("b");
	assert.equal(island.activeId(), "a");
});

test("a re-entrant close during a switch leaves the new view active", () => {
	const { island, state, views, host } = makeHarness();
	// View a dismisses itself from within close(), exactly like the real
	// modules (close() -> overlay release -> island.dismiss()).
	views.a.close = () => {
		state.get("a").open = false;
		island.dismiss("a");
	};
	state.get("a").open = true;
	island.present("a");
	state.get("b").open = true;
	island.present("b");
	assert.equal(island.activeId(), "b");
	assert.equal(host.getAttribute("aria-hidden"), "false");
	assert.ok(host.classList.contains("command-island--active"));
});
