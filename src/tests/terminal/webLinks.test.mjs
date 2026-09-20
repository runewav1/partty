/**
 * Wiring tests for the WebLinksAddon adapter (src/terminal/webLinks.ts).
 *
 * The addon only exports `WebLinksAddon`, so the adapter captures the provider
 * it registers and re-registers it decorated. These tests use a minimal fake
 * terminal/buffer good enough for WebLinkProvider's boundary scan; no xterm
 * instance, DOM or private internals are involved.
 *
 * Run: node --experimental-strip-types --test src/tests/terminal/webLinks.test.mjs
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const { setActivationModifier } = await import(
	"../../terminal/linkProvider.ts"
);
const { registerWebLinksProvider } = await import("../../terminal/webLinks.ts");

function makeFakeTerminal(text) {
	const registrations = [];
	const disposed = [];
	const line = {
		isWrapped: false,
		length: text.length,
		translateToString: () => text,
		getCell(x, target) {
			const ch = text[x] ?? "";
			target.getChars = () => ch;
			target.getWidth = () => (ch ? 1 : 0);
		},
	};
	const term = {
		cols: 200,
		rows: 24,
		buffer: {
			active: {
				getLine: (i) => (i === 0 ? line : undefined),
				getNullCell: () => ({}),
			},
		},
		registerLinkProvider(provider) {
			registrations.push(provider);
			return { dispose: () => disposed.push(provider) };
		},
	};
	return { term, registrations, disposed };
}

test("registerWebLinksProvider registers a decorated addon provider", () => {
	setActivationModifier(false);
	// biome-ignore lint/security/noSecrets: Test fixture URL, not a secret.
	const url = "https://example.com/a/b?c=1&d=2#frag";
	const { term, registrations, disposed } = makeFakeTerminal(`see ${url} end`);
	const activated = [];
	const controller = registerWebLinksProvider(term, (_event, uri) =>
		activated.push(uri),
	);

	assert.equal(registrations.length, 1);
	let links;
	registrations[0].provideLinks(1, (result) => {
		links = result;
	});
	assert.ok(links && links.length === 1);
	assert.equal(links[0].text, url);
	assert.equal(links[0].decorations.underline, true);
	assert.equal(links[0].decorations.pointerCursor, false);

	links[0].hover({ ctrlKey: true, metaKey: false }, links[0].text);
	assert.equal(links[0].decorations.pointerCursor, true);

	links[0].activate({ button: 0 }, links[0].text);
	assert.deepEqual(activated, [url]);

	controller.dispose();
	assert.equal(disposed.length, 1);
});
