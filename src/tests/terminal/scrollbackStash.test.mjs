import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createVmLoader } from "../support/vm.mjs";

function loadStash(invoke) {
	const root = new URL("../../", import.meta.url);
	const stub = (name) => fileURLToPath(new URL(`terminal/${name}.ts`, root));
	return createVmLoader({
		root,
		stubs: {
			"@tauri-apps/api/core": { invoke },
			[stub("paneHost")]: { ensurePaneSerialize: assert.fail },
			[stub("termLifecycle")]: { firstContentScrollbackLine: assert.fail },
		},
	}).api("./terminal/scrollbackStash.ts");
}

const hostFor = (term) => ({ forEachPane: (visit) => visit("1a", { term }) });

test("restore sizes the pane before replay and marks it restored only after parsing", async () => {
	const calls = [];
	const { restoreScrollbackIfNeeded } = await loadStash(async (command) => {
		calls.push(command);
		return command === "take_webview_destroyed_for_hide"
			? true
			: { "1a": JSON.stringify({ data: "prompt", cols: 80, rows: 24 }) };
	});
	const queued = Promise.withResolvers();
	const host = hostFor({
		resize: (...size) => calls.push(size),
		write: (data, parsed) => {
			calls.push(data);
			queued.resolve(parsed);
		},
	});
	const restored = restoreScrollbackIfNeeded([host], false, false, (id) =>
		calls.push(id),
	);
	const parsed = await queued.promise;
	assert.deepEqual(calls, [
		"take_webview_destroyed_for_hide",
		"take_terminal_buffers",
		[80, 24],
		"prompt",
	]);
	parsed();
	await restored;
	assert.equal(calls.at(-1), "1a");
});

test("discard resets the pane on hide and consumes the stash without replay", async () => {
	const calls = [];
	const { stashScrollbackForHide, restoreScrollbackIfNeeded } = await loadStash(
		async (command, args) => {
			calls.push(command);
			if (command === "stash_terminal_buffers") {
				assert.equal(Object.keys(args.buffers).length, 0);
			}
			return command === "take_webview_destroyed_for_hide"
				? true
				: { "1a": "old prompt" };
		},
	);
	const host = hostFor({
		reset: () => calls.push("reset"),
		write: assert.fail,
	});
	await stashScrollbackForHide([host], {
		destroy_webview_on_hide: true,
		discard_buffer_on_hide: true,
	});
	await restoreScrollbackIfNeeded([host], true, false, assert.fail);
	assert.deepEqual(calls, [
		"reset",
		"stash_terminal_buffers",
		"take_webview_destroyed_for_hide",
		"take_terminal_buffers",
	]);
});
