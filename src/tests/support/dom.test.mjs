/**
 * Contract tests for the shared DOM stand-ins (support/dom.mjs).
 *
 * These pin the semantics controller assertions depend on: className reads
 * back, textContent replaces children, replaceChildren detaches the old
 * generation, and appendChild reparents without duplicating. If any of these
 * regress, controller tests would silently assert on stale state.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeElement, FakeFragment, matchesSelector } from "./dom.mjs";

test("className reflects the class list in both directions", () => {
	const el = new FakeElement("div");
	el.className = "a b";
	assert.equal(el.className, "a b");
	assert.equal(el.classList.contains("a"), true);
	el.classList.add("c");
	assert.equal(el.className, "a b c");
	el.classList.remove("a");
	assert.equal(el.className, "b c");
	el.className = "";
	assert.equal(el.className, "");
});

test("setting textContent clears children and reads back descendants", () => {
	const parent = new FakeElement();
	const child = new FakeElement("span");
	child.textContent = "hello";
	parent.appendChild(child);
	parent._text = "pre";
	assert.equal(parent.textContent, "prehello");

	parent.textContent = "reset";
	assert.equal(parent.children.length, 0);
	assert.equal(child.parentElement, null);
	assert.equal(parent.textContent, "reset");
});

test("replaceChildren detaches the previous children", () => {
	const parent = new FakeElement();
	const oldChild = new FakeElement();
	const next = new FakeElement();
	parent.append(oldChild, new FakeElement());
	parent.replaceChildren(next);

	assert.equal(oldChild.parentElement, null);
	assert.equal(oldChild.parentNode, null);
	assert.deepEqual(parent.children, [next]);
	assert.equal(next.parentElement, parent);
});

test("appendChild reparents instead of duplicating", () => {
	const from = new FakeElement();
	const to = new FakeElement();
	const child = new FakeElement();
	from.appendChild(child);
	to.appendChild(child);
	assert.deepEqual(from.children, []);
	assert.deepEqual(to.children, [child]);
});

test("fragments flatten into the parent and selectors match data attributes", () => {
	const parent = new FakeElement();
	const fragment = new FakeFragment();
	const item = new FakeElement("li");
	item.dataset.index = "0";
	fragment.appendChild(item);
	parent.replaceChildren(fragment);

	assert.equal(parent.children.length, 1);
	assert.equal(parent.children[0], item);
	assert.equal(item.parentElement, parent);
	assert.equal(fragment.children.length, 0);
	assert.equal(matchesSelector(item, '[data-index="0"]'), true);
	assert.equal(parent.querySelector('[data-index="0"]'), item);
});
