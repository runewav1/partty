import assert from "node:assert/strict";
import { test } from "node:test";
import serialize from "@xterm/addon-serialize";
import xterm from "@xterm/xterm";
import { serializeReplayMouseEncoding } from "../../terminal/replayModes.ts";

const { Terminal } = xterm;
const { SerializeAddon } = serialize;
const write = (term, data) =>
	new Promise((resolve) => term.write(data, resolve));

for (const [mode, encoding] of [
	[1006, "SGR"],
	[1016, "SGR_PIXELS"],
]) {
	test(`alternate-screen replay preserves ${encoding} wheel reports`, async (t) => {
		const original = new Terminal({
			cols: 20,
			rows: 5,
			allowProposedApi: true,
		});
		const restored = new Terminal({
			cols: 20,
			rows: 5,
			allowProposedApi: true,
		});
		t.after(() => {
			original.dispose();
			restored.dispose();
		});
		const addon = new SerializeAddon();
		original.loadAddon(addon);
		await write(original, `\x1b[?1049h\x1b[?1002h\x1b[?${mode}hTUI`);
		await write(
			restored,
			addon.serialize({ range: { start: 0, end: 4 } }) +
				serializeReplayMouseEncoding(original),
		);
		assert.equal(restored.buffer.active.type, "alternate");
		assert.equal(restored.modes.mouseTrackingMode, "drag");
		assert.equal(restored._core.mouseStateService.activeEncoding, encoding);
		for (const action of [0, 1]) {
			const wheel = {
				button: 4,
				action,
				col: 3,
				row: 2,
				x: 30,
				y: 20,
				ctrl: false,
				alt: false,
				shift: false,
			};
			assert.equal(
				restored._core.mouseStateService.encodeMouseEvent(wheel),
				original._core.mouseStateService.encodeMouseEvent(wheel),
			);
			assert.ok(
				restored._core.mouseStateService
					.encodeMouseEvent(wheel)
					.startsWith("\x1b[<"),
			);
		}
	});
}

test("default mouse encoding needs no additional replay sequences", (t) => {
	const term = new Terminal();
	t.after(() => term.dispose());
	assert.equal(serializeReplayMouseEncoding(term), "");
});
