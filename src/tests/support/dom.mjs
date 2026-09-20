/**
 * Minimal shared DOM stand-ins for controller tests.
 *
 * This is deliberately *not* a browser simulator: it only implements the node
 * surface the controllers under test actually touch, but the parts it does
 * implement follow real DOM semantics for the properties assertions rely on
 * (className reads back, setting textContent replaces children, replaceChildren
 * detaches the old children). Suite-specific behavior (animation frames,
 * geometry reads) stays in its own suite rather than being generalized here.
 */

const WHITESPACE_RE = /\s+/;

export class FakeClassList {
	#set = new Set();

	add(...names) {
		for (const name of names) if (name) this.#set.add(name);
	}
	remove(...names) {
		for (const name of names) this.#set.delete(name);
	}
	contains(name) {
		return this.#set.has(name);
	}
	toggle(name, force) {
		const on = force === undefined ? !this.#set.has(name) : Boolean(force);
		if (on) this.#set.add(name);
		else this.#set.delete(name);
		return on;
	}
	reset(raw) {
		this.#set.clear();
		if (!raw) return;
		for (const name of String(raw).split(WHITESPACE_RE)) {
			if (name) this.#set.add(name);
		}
	}
	toString() {
		return [...this.#set].join(" ");
	}
}

export function matchesSelector(el, selector) {
	if (selector.startsWith(".")) return el.classList.contains(selector.slice(1));
	if (selector === "[data-index]") return el.dataset.index !== undefined;
	const prefix = '[data-index="';
	if (selector.startsWith(prefix)) {
		return el.dataset.index === selector.slice(prefix.length, -2);
	}
	return false;
}

function detach(child) {
	if (child.parentElement) {
		child.parentElement.children = child.parentElement.children.filter(
			(c) => c !== child,
		);
	}
	child.parentElement = null;
	child.parentNode = null;
}

export class FakeElement {
	constructor(tag = "div") {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.parentElement = null;
		this.parentNode = null;
		this.classList = new FakeClassList();
		this.dataset = {};
		this.attrs = new Map();
		this.listeners = new Map();
		this.style = {};
		this._text = "";
		this.innerHTML = "";
		this.tabIndex = undefined;
		this.title = "";
	}

	get textContent() {
		let out = this._text;
		for (const child of this.children) out += child.textContent ?? "";
		return out;
	}
	set textContent(value) {
		// Real DOM replaces all children with a single text node.
		for (const child of [...this.children]) detach(child);
		this.children = [];
		this._text = String(value);
	}

	set className(value) {
		this.classList.reset(value);
	}
	get className() {
		return this.classList.toString();
	}

	setAttribute(name, value) {
		this.attrs.set(name, String(value));
	}
	getAttribute(name) {
		return this.attrs.has(name) ? this.attrs.get(name) : null;
	}
	removeAttribute(name) {
		this.attrs.delete(name);
	}

	appendChild(child) {
		if (child.parentElement) {
			child.parentElement.children = child.parentElement.children.filter(
				(c) => c !== child,
			);
		}
		child.parentElement = this;
		child.parentNode = this;
		this.children.push(child);
		return child;
	}
	append(...children) {
		for (const child of children) this.appendChild(child);
	}
	replaceChildren(...nodes) {
		// Detach the previous generation before wiring the new one so stale
		// parent/child links cannot survive (assertions would otherwise see them).
		for (const child of [...this.children]) detach(child);
		this.children = [];
		for (const node of nodes) {
			if (!node) continue;
			if (node.isFragment) {
				for (const child of [...node.children]) this.appendChild(child);
				node.children = [];
			} else this.appendChild(node);
		}
	}
	querySelectorAll(selector) {
		const out = [];
		const walk = (node) => {
			for (const child of node.children) {
				if (matchesSelector(child, selector)) out.push(child);
				walk(child);
			}
		};
		walk(this);
		return out;
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}

	addEventListener(type, fn) {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}
	removeEventListener(type, fn) {
		const list = this.listeners.get(type);
		if (list) {
			this.listeners.set(
				type,
				list.filter((f) => f !== fn),
			);
		}
	}
	dispatch(type) {
		for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
	}
	click() {
		this.dispatch("click");
	}

	contains(other) {
		if (!other) return false;
		if (other === this) return true;
		return this.children.some((c) => c.contains(other));
	}
	remove() {
		detach(this);
	}

	focus() {}
	scrollIntoView() {}
	setSelectionRange() {}
}

export class FakeFragment {
	constructor() {
		this.isFragment = true;
		this.children = [];
	}
	appendChild(child) {
		this.children.push(child);
		return child;
	}
	append(...children) {
		for (const child of children) this.appendChild(child);
	}
}
