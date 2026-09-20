// Real source modules exercise disk loading; inline graphs cover module isolation.

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { createVmLoader } from "./vm.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const A = "left.ts";
const B = "right.ts";

function makeLoader() {
	return stubLoader(
		{
			[resolve(ROOT, A)]:
				'export { shared } from "./shared.ts"; export { expandRelativePath } from "./util/paths";',
			[resolve(ROOT, B)]:
				'export { shared } from "./shared.ts"; export { expandRelativePath } from "./util/paths";',
			[resolve(ROOT, "shared.ts")]:
				"globalThis.evaluations++; export const shared = {};",
		},
		{ evaluations: 0 },
	);
}

/** Guard so a loader deadlock fails the test instead of hanging the run. */
function withTimeout(promise, label) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2000);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function stubLoader(stubs, globals = {}) {
	return createVmLoader({ root: ROOT, globals, stubs });
}

const SLOW = resolve(ROOT, "slow.ts");
const PARENT = resolve(ROOT, "parent.ts");
const BOOM_RE = /boom/;

/** Flush a fixed number of microtask turns without awaiting inside a loop. */
function flushMicrotasks(turns) {
	let chain = Promise.resolve();
	for (let i = 0; i < turns; i += 1) chain = chain.then(() => undefined);
	return chain;
}

test("concurrent disk imports share one module instance", async () => {
	const loader = makeLoader();
	const results = await Promise.all(
		Array.from({ length: 16 }, () => loader.api("util/paths.ts")),
	);
	const [first] = results;
	for (const namespace of results) {
		assert.equal(namespace, first, "same namespace object");
		assert.equal(namespace.expandRelativePath, first.expandRelativePath);
	}
});

test("a diamond dependency resolves to one shared instance", async () => {
	const loader = makeLoader();
	const [a, b] = await Promise.all([loader.api(A), loader.api(B)]);
	assert.equal(a.shared, b.shared);
	assert.equal(a.expandRelativePath, b.expandRelativePath);
	assert.equal(loader.context.evaluations, 1);
});

test("static cycles link without blocking concurrent imports", async () => {
	const loader = stubLoader({
		[resolve(ROOT, "cycle-a.ts")]:
			'import { b } from "./cycle-b.ts"; export const a = "a"; export const readB = () => b;',
		[resolve(ROOT, "cycle-b.ts")]:
			'import { a } from "./cycle-a.ts"; export const b = "b"; export const readA = () => a;',
	});
	const [a, b] = await withTimeout(
		Promise.all([loader.api("cycle-a.ts"), loader.api("cycle-b.ts")]),
		"static cycle",
	);
	assert.equal(a.readB(), b.b);
	assert.equal(b.readA(), a.a);
});

test("separate loader instances do not share modules or global state", async () => {
	const first = makeLoader();
	const second = makeLoader();
	const [a1, a2] = await Promise.all([first.api(A), second.api(A)]);
	assert.notEqual(a1.shared, a2.shared, "distinct module instances per loader");
	assert.equal(first.context.evaluations, 1);
	assert.equal(second.context.evaluations, 1);
});

test("api() waits for an in-flight dependency evaluation instead of resolving early", async () => {
	let markStarted;
	const started = new Promise((resolveStarted) => {
		markStarted = resolveStarted;
	});
	let openGate;
	const gate = new Promise((resolveGate) => {
		openGate = resolveGate;
	});

	const loader = stubLoader(
		{
			[SLOW]:
				"globalThis.markStarted();\nawait globalThis.gate;\nexport const value = 42;\n",
			[PARENT]: 'export { value } from "./slow.ts";\n',
		},
		{ markStarted: () => markStarted(), gate },
	);

	const parentNamespace = loader.api("parent.ts");
	await withTimeout(started, "slow evaluation start");

	let slowSettled = false;
	const slowNamespace = loader.api("slow.ts").then((namespace) => {
		slowSettled = true;
		return namespace;
	});

	// Flush microtasks: without the fix this resolves while the gate is shut.
	await flushMicrotasks(8);
	assert.equal(
		slowSettled,
		false,
		"api(slow) must not resolve while slow is parked on its top-level await",
	);

	openGate();
	const [parent, slow] = await withTimeout(
		Promise.all([parentNamespace, slowNamespace]),
		"TLA completion",
	);
	assert.equal(slow.value, 42);
	assert.equal(parent.value, 42);
});

test("string stubs support dynamic import like disk modules", async () => {
	const loader = stubLoader({
		[resolve(ROOT, "dyn.ts")]: "export const dynValue = 7;\n",
		[resolve(ROOT, "entry.ts")]:
			'const mod = await import("./dyn.ts");\nexport const viaDynamic = mod.dynValue;\n',
	});
	const namespace = await withTimeout(loader.api("entry.ts"), "dynamic import");
	assert.equal(namespace.viaDynamic, 7);
});

test("a dependency evaluation error propagates to every importer", async () => {
	const loader = stubLoader({
		[resolve(ROOT, "boom.ts")]: 'throw new Error("boom");\n',
		[resolve(ROOT, "uses-boom.ts")]:
			'import "./boom.ts";\nexport const ok = true;\n',
	});

	await assert.rejects(
		withTimeout(loader.api("uses-boom.ts"), "dep error"),
		BOOM_RE,
	);
	await assert.rejects(
		withTimeout(loader.api("boom.ts"), "repeat dep error"),
		BOOM_RE,
	);
});
