import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseWorkspaceSearch,
	workspacePaletteCommands,
} from "../../app/workspacePalette.ts";
import { selectTabProgress } from "../../pty/ptyProgress.ts";
import { sshPaneTarget } from "../../tabs/displayNames.ts";
import { createVmLoader } from "../support/vm.mjs";

const progress = { state: "normal", value: 42 };
const noop = () => {};
const tabs = [
	{
		id: "work",
		index: 1,
		label: "Zeta <work>",
		progress,
		run: noop,
		panes: [
			{
				paneId: "1:a",
				profileName: "PowerShell",
				cwd: "C:\\code\\app",
				progress: null,
				run: noop,
			},
			{
				paneId: "1:b",
				profileName: "Production",
				remote: sshPaneTarget("prod.example.test", "deploy", "192.0.2.7"),
				processLabel: "build <main>",
				startedAt: 4000,
				progress,
				run: noop,
			},
		],
	},
	{
		id: "spare",
		index: 2,
		label: "Alpha",
		progress: null,
		panes: [],
		run: noop,
	},
];

test("leading-colon queries load search on demand and only the active query refreshes", async () => {
	let nextFrame = 0;
	const frames = new Map();
	const loader = createVmLoader({
		root: new URL("../../", import.meta.url),
		globals: {
			performance,
			requestAnimationFrame: (step) => {
				frames.set(++nextFrame, step);
				return nextFrame;
			},
			cancelAnimationFrame: (id) => frames.delete(id),
		},
	});
	const { lazyWorkspaceSearch, workspaceSearchQuery } = await loader.api(
		"app/lazyWorkspaceSearch.ts",
	);
	assert.equal(workspaceSearchQuery("  :"), "");
	assert.equal(workspaceSearchQuery(" :deploy build "), "deploy build");
	assert.equal(workspaceSearchQuery(": deploy@host"), "deploy@host");
	assert.equal(workspaceSearchQuery("@"), undefined);
	assert.equal(workspaceSearchQuery("@profile:float"), undefined);
	assert.equal(workspaceSearchQuery("deploy:build"), undefined);

	const pane = { ...tabs[0].panes[0], sessionId: "shell" };
	const line = { translateToString: () => "new prompt" };
	const buffer = { type: "normal", length: 1, getLine: () => line };
	const term = { cols: 80, buffer: { active: buffer, normal: buffer } };
	const search = lazyWorkspaceSearch({
		tabs: () => [{ ...tabs[0], panes: [{ ...pane }] }],
		activeTabId: () => tabs[0].id,
		focusedPaneId: () => pane.paneId,
		nearbyPaneIds: () => null,
		terminal: (id) => (id === "shell" ? term : undefined),
	});
	assert.equal(search.filter("regular", 100, assert.fail, true), undefined);
	assert.equal(search.filter(":", 100, assert.fail, false), undefined);
	assert.equal(search.scanning, false);

	let staleRefreshes = 0;
	search.filter(':"old prompt"', 100, () => staleRefreshes++, true);
	assert.equal(search.emptyText, "Loading workspace search…");
	search.clear();
	const loaded = Promise.withResolvers();
	const query = ':"new prompt"';
	search.filter(query, 100, loaded.resolve, true);
	await loaded.promise;
	assert.equal(staleRefreshes, 0);

	let results;
	const refresh = () => {
		results = search.filter(query, 100, refresh, true);
	};
	search.filter(':"old prompt"', 100, () => staleRefreshes++, true);
	search.filter(query, 100, refresh, true);
	assert.equal(frames.size, 1, "changing the query cancels the previous scan");
	for (const [id, step] of frames) {
		frames.delete(id);
		step();
	}
	assert.equal(staleRefreshes, 0);
	assert.ok(results.some((row) => row.labelHtml?.includes("new prompt")));
	search.filter(':"third prompt"', 100, assert.fail, true);
	assert.equal(frames.size, 1);
	search.clear();
	assert.equal(search.scanning, false);
	assert.equal(frames.size, 0);
});

test("scrollback search requires a complete literal phrase of at least three characters", () => {
	for (const query of [
		"x",
		"xy",
		'"a"',
		'"🙂🙂"',
		'"pnpm tunnel:start',
		'xy "build"',
	]) {
		assert.equal(parseWorkspaceSearch(query), null);
	}
	assert.deepEqual(parseWorkspaceSearch("2"), { metadata: "2" });
	assert.deepEqual(parseWorkspaceSearch('deploy "pnpm tunnel:start"'), {
		metadata: "deploy",
		phrase: "pnpm tunnel:start",
	});
	assert.deepEqual(parseWorkspaceSearch(String.raw`"say \"hi\""`), {
		metadata: "",
		phrase: 'say "hi"',
	});
	assert.equal(parseWorkspaceSearch(`"${"\\".repeat(5000)}`), null);
});

test("quoted results expose selectable, escaped previews and unfold only their pane", () => {
	const hits = {
		count: 7,
		matches: Array.from({ length: 5 }, (_, row) => ({
			row,
			rowText: "<abc>",
			before: "<",
			text: "abc",
			after: ">",
		})),
	};
	let target;
	const panes = [
		{
			...tabs[0].panes[0],
			hits,
			searchTerms: "hidden-distro",
			toggleMatches: () => {
				panes[0].expanded = !panes[0].expanded;
			},
			runMatch: (match) => {
				target = match.row;
			},
		},
		{ ...tabs[0].panes[1], hits },
	];
	const render = () =>
		workspacePaletteCommands([{ ...tabs[0], panes }], "", 0, true);
	const [header, pane, preview] = render();
	assert.equal(header.appearance, "workspace-tab");
	assert.equal(pane.status, "7 matches");
	assert.equal(preview.labelHtml, "&lt;<mark>abc</mark>&gt;");
	void preview.run();
	assert.equal(target, 0);
	assert.equal(
		render().filter((row) => row.appearance === "workspace-match").length,
		6,
	);
	pane.onTab();
	assert.equal(
		render().filter((row) => row.appearance === "workspace-match").length,
		8,
	);
	assert.equal(
		workspacePaletteCommands([{ ...tabs[0], panes }], "hidden-distro")[1].id,
		pane.id,
	);
});

test("workspace results retain tab and pane order and combine tab and pane terms", () => {
	const ids = (query) =>
		workspacePaletteCommands(tabs, query, 6100).map((c) => c.id);
	assert.deepEqual(ids(""), [
		"workspace-tab-work",
		"workspace-pane-work-1:a",
		"workspace-pane-work-1:b",
		"workspace-tab-spare",
	]);
	assert.deepEqual(ids("zeta deploy 192.0.2.7"), [
		"workspace-tab-work",
		"workspace-pane-work-1:b",
	]);
	assert.deepEqual(ids("zeta"), ids("1"));
	assert.deepEqual(ids("tab 2"), ["workspace-tab-spare"]);
	assert.deepEqual(ids("idle"), [
		"workspace-tab-work",
		"workspace-pane-work-1:a",
	]);
	assert.deepEqual(ids("unknown"), []);
});

test("remote rows expose command, elapsed time, escaped identity, and progress", () => {
	const [tab, idle, running] = workspacePaletteCommands(tabs, "", 6100);
	assert.equal(tab.progress, progress);
	assert.ok(tab.labelHtml.includes("Zeta &lt;work&gt;"));
	assert.equal(idle.status, "Idle");
	assert.equal(running.status, "2s");
	assert.equal(running.appearance, "workspace-remote");
	assert.equal(running.progress, progress);
	assert.ok(running.labelHtml.includes("build &lt;main&gt;"));
	assert.ok(running.labelHtml.includes("deploy@prod.example.test · 192.0.2.7"));
	assert.deepEqual(sshPaneTarget("admin@host", "unused", ""), {
		target: "admin@host",
		ip: undefined,
	});
	assert.deepEqual(sshPaneTarget("", "admin", "2001:db8::2"), {
		target: "admin@2001:db8::2",
		ip: undefined,
	});
	assert.equal(sshPaneTarget("", "", ""), undefined);
});

test("tab progress is scoped to the current layout and follows Windows Terminal priority", () => {
	const states = {
		a: { state: "indeterminate", value: 0 },
		b: progress,
		c: { state: "paused", value: 31 },
		d: { state: "error", value: 9 },
		e: { state: "error", value: 11 },
		cleared: { state: "clear", value: 0 },
	};
	const get = (id) => states[id] ?? null;
	assert.equal(selectTabProgress(["cleared", "missing"], get), null);
	assert.equal(selectTabProgress(["a", "b"], get), states.b);
	assert.equal(selectTabProgress(["a", "b", "c"], get), states.c);
	assert.equal(selectTabProgress(["a", "b", "c", "d", "e"], get), states.d);
	assert.equal(selectTabProgress(["e", "d"], get), states.e);
	assert.equal(selectTabProgress(["a"], get), states.a);
});

test("OSC-only panes are not labeled idle and keep their stable row id", () => {
	const pane = {
		paneId: "old",
		sessionId: "session-a",
		profileName: "SSH profile",
		remote: { target: "SSH profile" },
		progress,
		run: noop,
	};
	const first = workspacePaletteCommands([{ ...tabs[0], panes: [pane] }], "");
	const second = workspacePaletteCommands(
		[{ ...tabs[1], panes: [{ ...pane, paneId: "moved" }] }],
		"remote",
	);
	assert.equal(first[1].status, "Progress");
	assert.equal(second[1].id, first[1].id);
	assert.equal(second[1].label, "SSH profile");
});
