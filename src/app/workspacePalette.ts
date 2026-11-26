import type { PtyProgress } from "../pty/ptyProgress";
import { cwdLastSegment, type PaneNameParts } from "../tabs/displayNames.ts";
import {
	COLLAPSED_MATCHES,
	type ScrollbackHits,
	type ScrollbackMatch,
} from "../terminal/scrollbackSearch.ts";
import { escapeHtml } from "../util/html.ts";
import { normalizeQuery, scoreLexicalMatch } from "../util/lexicalSearch.ts";
import type { PaletteCommand } from "./commandPalette";

const TAB_INDEX = /^(?:tab\s+)?([1-9]\d*)$/i;
const QUOTED_SEARCH = /^([^"]*)"((?:\\["\\]|\\(?!["\\])|[^"\\])*)"$/;

export type WorkspacePalettePane = PaneNameParts & {
	sessionId?: string;
	remote?: { target: string; ip?: string };
	startedAt?: number;
	searchTerms?: string;
	hits?: ScrollbackHits;
	expanded?: boolean;
	toggleMatches?: () => void;
	runMatch?: (match: ScrollbackMatch) => void;
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

export function parseWorkspaceSearch(query: string): {
	metadata: string;
	phrase?: string;
} | null {
	if (!query.includes('"')) {
		return !query || TAB_INDEX.test(query) || Array.from(query).length >= 3
			? { metadata: query }
			: null;
	}
	const match = QUOTED_SEARCH.exec(query);
	if (!match) return null;
	const phrase = match[2]!.replace(/\\(["\\])/g, "$1");
	const metadata = match[1]!.trim();
	return Array.from(phrase.trim()).length >= 3 &&
		(!metadata || TAB_INDEX.test(metadata) || Array.from(metadata).length >= 3)
		? { metadata, phrase }
		: null;
}

export function workspacePaletteCommands(
	tabs: readonly WorkspacePaletteTab[],
	query: string,
	now = Date.now(),
	quoted = false,
): PaletteCommand[] {
	const tabIndex = query.match(TAB_INDEX)?.[1];
	const parts = tabIndex ? [] : normalizeQuery(query);
	const normalized = parts.join(" ");
	const groups: { rows: PaletteCommand[]; score: number }[] = [];
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
		const children = new Map<string, PaletteCommand[]>();
		const panes = tab.panes
			.filter((pane) => !quoted || pane.hits?.count)
			.map((pane) => {
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
				const id = `workspace-pane-${pane.sessionId ?? `${tab.id}-${pane.paneId}`}`;
				if (pane.hits) {
					const visible = pane.expanded
						? pane.hits.matches
						: pane.hits.matches.slice(0, COLLAPSED_MATCHES);
					children.set(
						id,
						visible.map((match, i) => ({
							id: `${id}-match-${i}`,
							label: match.before + match.text + match.after,
							labelHtml: `${escapeHtml(match.before)}<mark>${escapeHtml(match.text)}</mark>${escapeHtml(match.after)}`,
							appearance: "workspace-match",
							run: () => pane.runMatch?.(match),
						})),
					);
				}
				const keywords = [
					"pane",
					pane.paneId,
					pane.profileName,
					pane.cwd,
					pane.oscTitle,
					detail,
					pane.remote ? "ssh remote" : null,
					running ? "running process" : reported ? "progress" : "idle",
					pane.searchTerms,
				].join(" ");
				const row: PaletteCommand = {
					id,
					label: headline,
					labelHtml: `<span class="cp-workspace-primary" title="${escapeHtml(headline)}">${badge}<span class="cp-label-name">${escapeHtml(headline)}</span></span>${detail ? ` <span class="cp-workspace-detail" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>` : ""}`,
					keywords: `${prefix} ${keywords}`,
					appearance: pane.remote ? "workspace-remote" : "workspace-pane",
					progress: pane.progress,
					hotkey: pane.toggleMatches ? "Tab" : undefined,
					status: pane.hits
						? `${pane.hits.count} ${pane.hits.count === 1 ? "match" : "matches"}`
						: running
							? `${Math.floor(Math.max(0, now - startedAt) / 1000)}s`
							: reported
								? "Progress"
								: "Idle",
					run: pane.run,
					onTab: pane.toggleMatches,
				};
				return {
					row,
					id,
					label: headline,
					keywords,
					remote: pane.remote?.target,
				};
			});
		const tabMatch = { id: header.id, label: tab.label, keywords: prefix };
		const tabScore = quoted
			? null
			: parts.length
				? scoreLexicalMatch(tabMatch, parts, normalized)
				: 0;
		const matches: { row: PaletteCommand; score: number }[] = [];
		for (const pane of panes) {
			let score = parts.length ? scoreLexicalMatch(pane, parts, normalized) : 0;
			if (parts.length && pane.remote && pane.remote !== pane.label) {
				const remote = scoreLexicalMatch(
					{ ...pane, label: pane.remote },
					parts,
					normalized,
				);
				if (remote !== null && (score === null || remote > score))
					score = remote;
			}
			if (score !== null) matches.push({ row: pane.row, score });
			else if (scoreLexicalMatch(pane.row, parts, normalized) !== null) {
				// A match that needs the tab's keywords ranks behind direct matches.
				matches.push({ row: pane.row, score: -1 });
			}
		}
		if (!matches.length && tabScore === null) continue;
		// In a text search, the header is selectable context unless it matches
		// on its own. Browse and numeric tab queries keep the header first.
		const headerMatch = { row: header, score: tabScore ?? -2 };
		if (parts.length) {
			matches.push(headerMatch);
			matches.sort((a, b) => b.score - a.score);
		} else {
			matches.unshift(headerMatch);
		}
		groups.push({
			rows: matches.flatMap(({ row }) => [
				row,
				...(children.get(row.id) ?? []),
			]),
			score: matches[0]!.score,
		});
	}
	if (parts.length) groups.sort((a, b) => b.score - a.score);
	return groups.flatMap(({ rows }) => rows);
}
