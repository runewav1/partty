import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

let mediaChanged;
const media = {
	matches: false,
	addEventListener: (_, callback) => {
		mediaChanged = callback;
	},
};
globalThis.window = { matchMedia: () => media };
const translation = /translateY\(([-\d.]+)px\)/;
// Ordered style-read/class log for the panel-measurement regression test.
let motionOps = [];
class Element {
	classes = new Set();
	children = [];
	animations = [];
	style = {
		setProperty(name, value) {
			this[name] = value;
		},
	};
	dataset = {};
	_offsetWidth = 600;
	_offsetHeight = 400;
	get offsetWidth() {
		motionOps.push(`read:${this.tag ?? "?"}:w`);
		return this._offsetWidth;
	}
	set offsetWidth(value) {
		this._offsetWidth = value;
	}
	get offsetHeight() {
		motionOps.push(`read:${this.tag ?? "?"}:h`);
		return this._offsetHeight;
	}
	set offsetHeight(value) {
		this._offsetHeight = value;
	}
	classList = {
		contains: (name) => this.classes.has(name),
		add: (name) => {
			this.classes.add(name);
			if (name === "island-rendered") motionOps.push("tag:island-rendered");
		},
		remove: (name) => this.classes.delete(name),
		toggle: (name, value) =>
			value ? this.classes.add(name) : this.classes.delete(name),
	};
	append(...children) {
		for (const child of children) {
			child.parentElement = this;
			this.children.push(child);
		}
	}
	setAttribute() {}
	remove() {
		this.removed = true;
		if (this.parentElement)
			this.parentElement.children = this.parentElement.children.filter(
				(el) => el !== this,
			);
	}
	querySelector() {
		return this.panel;
	}
	getBoundingClientRect() {
		if (this.visual)
			return { width: this.visual.width, bottom: this.visual.height, top: 0 };
		const height = Number.parseFloat(this.style.height) || 0;
		const y = Number(translation.exec(this.style.transform)?.[1] || 0);
		return {
			width:
				Number.parseFloat(this.parentElement?.style.width) || this.offsetWidth,
			bottom: height + y,
			top: 0,
		};
	}
	animate(frames, options) {
		const animation = {
			frames,
			options,
			cancel() {
				this.cancelled = true;
			},
		};
		this.animations.push(animation);
		return animation;
	}
}
globalThis.ResizeObserver = class {
	constructor(callback) {
		this.callback = callback;
	}
	observe(element) {
		element.observer = this;
	}
	disconnect() {
		this.disconnected = true;
	}
};
const root = new Element();
globalThis.document = {
	documentElement: root,
	createElement: () => new Element(),
	timeline: { currentTime: 42 },
};
globalThis.getComputedStyle = () => ({
	opacity: "1",
	getPropertyValue: () =>
		root.dataset.motionStyle === "gentle"
			? "cubic-bezier(0.33, 1, 0.68, 1)"
			: "cubic-bezier(0.22, 1, 0.36, 1)",
});
const { showSurface, hideSurface, applyMotionPreferences } = await import(
	"../../util/motion.ts"
);
const { disposeIslandMotion, finishIslandMotion, prepareIslandView } =
	await import("../../util/islandMotion.ts");

// Surfaces created by a test, torn down even when an assertion fails.
const created = [];

// Reset all shared DOM, class, preference and motion state before each test so
// tests are independent under the per-file process and standalone runs.
beforeEach(() => {
	root.children = [];
	root.classes.clear();
	root.dataset = {};
	media.matches = false;
	motionOps = [];
	applyMotionPreferences("normal", "smooth");
});

afterEach(() => {
	for (const el of created) disposeIslandMotion(el);
	finishIslandMotion();
	created.length = 0;
	root.children = [];
	root.classes.clear();
	root.dataset = {};
	media.matches = false;
	motionOps = [];
	applyMotionPreferences("normal", "smooth");
});

function surface(host = new Element()) {
	const el = new Element();
	el.classList.add("command-island-view");
	el.classList.add("hidden");
	el.panel = new Element();
	host.append(el);
	created.push(el);
	return el;
}
function shell(el) {
	return el.parentElement.children.find(
		(child) => child.className === "island-shell",
	);
}
function complete(el) {
	shell(el).children[0].animations.at(-1).onfinish();
}

test("entrance stays full-width and closing cleans up the observer and shell", () => {
	const el = surface();
	showSurface(el, "hidden");
	const frame = shell(el);
	const [body] = frame.children;
	assert.deepEqual(body.animations[0].frames, [
		{ transform: "translateY(-400px) scaleX(1)" },
		{ transform: "translateY(0px) scaleX(1)" },
	]);
	assert.equal(body.animations[0].startTime, 42);
	complete(el);
	hideSurface(el, "hidden");
	assert.ok(
		body.animations[1].options.duration < body.animations[0].options.duration,
	);
	complete(el);
	assert.equal(el.classList.contains("hidden"), true);
	assert.equal(frame.removed, true);
	assert.equal(el.panel.observer.disconnected, true);
});

test("growth and interrupted shrink morph from the visible size, not the target", () => {
	const el = surface();
	showSurface(el, "hidden");
	complete(el);
	const [body] = shell(el).children;
	el.panel.offsetHeight = 520;
	el.panel.observer.callback();
	assert.equal(
		body.animations.at(-1).frames[0].transform,
		"translateY(-120px) scaleX(1)",
	);
	body.visual = { width: 600, height: 460 };
	el.panel.offsetHeight = 240;
	el.panel.observer.callback();
	assert.equal(
		body.animations.at(-1).frames[0].transform,
		"translateY(0px) scaleX(1)",
	);
	assert.equal(
		body.animations.at(-1).frames[1].transform,
		"translateY(-220px) scaleX(1)",
	);
	assert.equal(
		el.panel.animations.at(-1).frames[0].clipPath,
		"inset(0px 0px 0px round 0px 0px 18px 18px)",
	);
	disposeIslandMotion(el);
});

test("view switching reuses the shell and morphs both dimensions without reopening", () => {
	const first = surface();
	showSurface(first, "hidden");
	complete(first);
	const original = shell(first);
	const next = surface(first.parentElement);
	next.panel.offsetWidth = 440;
	next.panel.offsetHeight = 280;
	prepareIslandView(first.parentElement, next);
	hideSurface(first, "hidden");
	assert.equal(first.classList.contains("hidden"), true);
	assert.equal(
		original.removed,
		undefined,
		"keep the shell during async preparation",
	);
	showSurface(next, "hidden");
	assert.equal(shell(next), original);
	const animation = original.children[0].animations.at(-1);
	assert.equal(
		animation.frames[0].transform,
		`translateY(0px) scaleX(${600 / 440})`,
	);
	assert.equal(animation.frames[1].transform, "translateY(-120px) scaleX(1)");
	assert.equal(next.panel.animations.at(-1).frames[0].opacity, 0);
	disposeIslandMotion(first);
	assert.equal(
		original.removed,
		undefined,
		"outgoing cleanup cannot dispose the incoming view",
	);
	disposeIslandMotion(next);
});

test("cancelling an async incoming view removes the held shell", () => {
	const first = surface();
	showSurface(first, "hidden");
	complete(first);
	const next = surface(first.parentElement);
	prepareIslandView(first.parentElement, next);
	hideSurface(first, "hidden");
	hideSurface(next, "hidden");
	assert.equal(shell(first), undefined);
});

test("reopening discards stale close completion and resumes visible geometry", () => {
	const el = surface();
	showSurface(el, "hidden");
	hideSurface(el, "hidden");
	const body = shell(el).children[0];
	const exit = body.animations.at(-1);
	body.visual = { width: 600, height: 160 };
	showSurface(el, "hidden");
	assert.equal(
		body.animations.at(-1).frames[0].transform,
		"translateY(-240px) scaleX(1)",
	);
	exit.onfinish();
	assert.equal(el.classList.contains("hidden"), false);
	disposeIslandMotion(el);
});

test("returning to the outgoing view cancels a pending handoff without losing the shell", () => {
	const first = surface();
	showSurface(first, "hidden");
	complete(first);
	const original = shell(first);
	const next = surface(first.parentElement);
	prepareIslandView(first.parentElement, next);
	hideSurface(first, "hidden");
	prepareIslandView(first.parentElement, first);
	hideSurface(next, "hidden");
	showSurface(first, "hidden");
	assert.equal(shell(first), original);
	complete(first);
	hideSurface(first, "hidden");
	complete(first);
	assert.equal(shell(first), undefined);
});

test("opening, live retiming, morphing, and closing share speed and feel preferences", () => {
	applyMotionPreferences("fast", "snappy");
	const el = surface();
	showSurface(el, "hidden");
	const body = shell(el).children[0];
	assert.equal(body.animations.at(-1).options.duration, 280 * (0.55 * 0.72));
	body.visual = { width: 600, height: 200 };
	applyMotionPreferences("slow", "gentle");
	assert.equal(body.animations.at(-1).options.duration, 280 * (1.65 * 1.28));
	assert.equal(
		body.animations.at(-1).options.easing,
		"cubic-bezier(0.33, 1, 0.68, 1)",
	);
	assert.equal(
		body.animations.at(-1).frames[0].transform,
		"translateY(-200px) scaleX(1)",
	);
	const retimed = body.animations.at(-1);
	applyMotionPreferences("slow", "gentle");
	assert.equal(
		body.animations.at(-1),
		retimed,
		"unchanged prefs must not restart motion",
	);
	complete(el);
	el.panel.offsetHeight = 520;
	el.panel.observer.callback();
	assert.equal(body.animations.at(-1).options.duration, 200 * (1.65 * 1.28));
	hideSurface(el, "hidden");
	assert.equal(body.animations.at(-1).options.duration, 200 * (1.65 * 1.28));
	applyMotionPreferences("off", "smooth");
	assert.equal(shell(el), undefined);
	applyMotionPreferences("normal", "smooth");
});

test("OS reduced motion completes pending morphs and skips future transitions", () => {
	const el = surface();
	showSurface(el, "hidden");
	el.panel.offsetHeight = 520;
	el.panel.observer.callback();
	media.matches = true;
	try {
		mediaChanged();
		const count = el.panel.animations.length;
		el.panel.offsetHeight = 240;
		el.panel.observer.callback();
		assert.equal(el.panel.animations.length, count);
		hideSurface(el, "hidden");
		assert.equal(shell(el), undefined);
	} finally {
		media.matches = false;
	}
});

test("first island open reads the panel once pre-tag and keeps the post-tag size", () => {
	const el = surface();
	el.panel.tag = "panel";
	const addClass = el.classList.add;
	el.classList.add = (name) => {
		addClass(name);
		if (name === "island-rendered") el.panel.offsetWidth = 620;
	};
	motionOps = [];
	showSurface(el, "hidden");
	assert.deepEqual(
		motionOps,
		[
			"read:panel:w",
			"read:panel:h",
			"tag:island-rendered",
			"read:panel:w",
			"read:panel:h",
		],
		"one pre-tag measure, then the post-tag size",
	);
	// The post-tag measurement still drives the shell/target geometry.
	assert.equal(shell(el).style.width, "620px");
	disposeIslandMotion(el);
});
