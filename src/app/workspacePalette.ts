import type { PtyProgress } from "../pty/ptyProgress";
import { cwdLastSegment, type PaneNameParts } from "../tabs/displayNames.ts";
import { escapeHtml } from "../util/html.ts";
import { filterAndRankLexical, normalizeQuery } from "../util/lexicalSearch.ts";
import type { PaletteCommand } from "./commandPalette";

const TAB_INDEX = /^(?:tab\s+)?([1-9]\d*)$/i;

export type WorkspacePalettePane = PaneNameParts & {
	sessionId?: string;
	remote?: { target: string; ip?: string };
	startedAt?: number;
	progress: PtyProgress | null;
	run: PaletteCommand["run"];
};

export type WorkspacePaletteTab = {
	id: string;
	index: number;
	label: string;
	progress: PtyProgress | null;
	panes: WorkspacePalettePane[];
	run: PaletteCommand["run"];
};

export function workspaceSearchQuery(raw: string): string | undefined {
	const query = raw.trimStart();
	return query.startsWith(":") ? query.slice(1).trim() : undefined;
}

/** Metadata only: never parse a commandline or change the SSH spawn target. */
export function sshPaneTarget(
	host: string | null | undefined,
	user: string | null | undefined,
	ip: string | null | undefined,
): WorkspacePalettePane["remote"] {
	const address = ip?.trim();
	const endpoint = host?.trim() || address;
	if (!endpoint) return undefined;
	const login = user?.trim();
	return {
		target:
			login && !endpoint.includes("@") ? `${login}@${endpoint}` : endpoint,
		ip: address && address !== endpoint.split("@").at(-1) ? address : undefined,
	};
}

/** Tab and pane rows retain their index / layout order, even under a filter. */
export function workspacePaletteCommands(
	tabs: readonly WorkspacePaletteTab[],
	query: string,
	now = Date.now(),
): PaletteCommand[] {
	const tabIndex = query.match(TAB_INDEX)?.[1];
	const parts = tabIndex ? [] : normalizeQuery(query);
	const rows: PaletteCommand[] = [];
	for (const tab of tabs) {
		if (tabIndex && tabIndex !== String(tab.index)) continue;
		const prefix = `tab ${tab.index} ${tab.label}`;
		const header: PaletteCommand = {
			id: `workspace-tab-${tab.id}`,
			label: prefix,
			labelHtml: `<span class="cp-workspace-index">${tab.index}</span> <span class="cp-label-name">${escapeHtml(tab.label)}</span>`,
			appearance: "workspace-tab",
			progress: tab.progress,
			run: tab.run,
		};
		const panes: PaletteCommand[] = tab.panes.map((pane) => {
			const { startedAt } = pane;
			const running = startedAt !== undefined;
			const reported = pane.progress && pane.progress.state !== "clear";
			const headline = running
				? pane.processLabel || "Running command"
				: pane.oscTitle || pane.remote?.target || pane.profileName;
			const detail = [
				(pane.remote?.target || pane.profileName) !== headline
					? pane.remote?.target || pane.profileName
					: null,
				pane.remote?.ip,
				cwdLastSegment(pane.cwd),
				tab.panes.length > 1 ? pane.paneId : null,
			]
				.filter(Boolean)
				.join(" · ");
			const badge = pane.remote
				? '<span class="cp-workspace-remote-tag">SSH</span> '
				: "";
			return {
				id: `workspace-pane-${pane.sessionId ?? `${tab.id}-${pane.paneId}`}`,
				label: headline,
				labelHtml: `<span class="cp-workspace-primary" title="${escapeHtml(headline)}">${badge}<span class="cp-label-name">${escapeHtml(headline)}</span></span>${detail ? ` <span class="cp-workspace-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>` : ""}`,
				keywords: [
					prefix,
					"pane",
					pane.paneId,
					pane.profileName,
					pane.cwd,
					pane.oscTitle,
					detail,
					pane.remote ? "ssh remote" : null,
					running ? "running process" : reported ? "progress" : "idle",
				].join(" "),
				appearance: pane.remote ? "workspace-remote" : "workspace-pane",
				progress: pane.progress,
				status: running
					? `${Math.floor(Math.max(0, now - startedAt) / 1000)}s`
					: reported
						? "Progress"
						: "Idle",
				run: pane.run,
			};
		});
		const matches = new Set(filterAndRankLexical(panes, parts));
		if (matches.size || filterAndRankLexical([header], parts).length) {
			rows.push(header, ...panes.filter((pane) => matches.has(pane)));
		}
	}
	return rows;
}
