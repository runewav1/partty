import assert from "node:assert/strict";
import { test } from "node:test";
import { createThemeFamilyShortcut } from "../../app/themeFamilyShortcut.ts";

test("tap on release and hold-to-choose are exclusive, including repeats and delayed timers", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let cycles = 0;
	let now = 0;
	const shown = [];
	const shortcut = createThemeFamilyShortcut(
		async () => {
			cycles++;
		},
		async (isCurrent) => {
			if (isCurrent()) shown.push("favorites");
		},
		assert.fail,
		() => now,
	);
	shortcut.press("KeyT");
	shortcut.release("KeyX");
	assert.equal(cycles, 0, "key-down and unrelated key-up must not cycle");
	t.mock.timers.tick(349);
	shortcut.release("KeyT");
	shortcut.release("KeyT");
	assert.equal(cycles, 1, "tap cycles exactly once on release");
	t.mock.timers.tick(1);
	await Promise.resolve();
	assert.deepEqual(shown, []);
	shortcut.press();
	shortcut.press();
	assert.equal(cycles, 1, "repeats never cycle");
	t.mock.timers.tick(349);
	await Promise.resolve();
	assert.deepEqual(shown, []);
	t.mock.timers.tick(1);
	await Promise.resolve();
	assert.deepEqual(shown, ["favorites"]);
	shortcut.release();
	assert.equal(cycles, 1, "releasing a hold must not cycle");
	shortcut.press();
	shortcut.cancel();
	shortcut.release();
	t.mock.timers.tick(350);
	assert.equal(cycles, 1, "blur cancels a tap rather than committing it");
	assert.equal(shown.length, 1);
	shortcut.press();
	now = 350;
	shortcut.release();
	assert.equal(
		cycles,
		1,
		"a late key-up cannot become a tap if the timer was delayed",
	);
	assert.equal(shown.length, 2);
});

test("release preserves a completed hold; blur cancels async picker setup", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	for (const blur of [false, true]) {
		let complete;
		const ready = new Promise((resolve) => {
			complete = resolve;
		});
		const delayed = createThemeFamilyShortcut(
			async () => assert.fail("hold cycled"),
			async (isCurrent) => {
				await ready;
				assert.equal(isCurrent(), !blur);
			},
			assert.fail,
		);
		delayed.press();
		t.mock.timers.tick(350);
		delayed.release();
		if (blur) delayed.cancel();
		complete();
		// biome-ignore lint/performance/noAwaitInLoops: Each gesture must finish before the next uses the shared clock.
		await ready;
	}
});
