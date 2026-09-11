/**
 * Terminal find bar — a compact island surface that searches the focused
 * terminal's scrollback, highlights every match with decorations, and cycles
 * through them. Implemented on top of xterm's public marker/decoration API so
 * it needs no extra addon.
 */

import type { IDecoration, IDisposable, IMarker, Terminal } from "@xterm/xterm";
import {
	type FindHighlightColors,
	terminalFindColors,
} from "../terminal/uiTheme";
import { hideSurface, showSurface } from "../util/motion";
import type { CommandIslandApi } from "./commandIsland";
import { type ScanMatch, type ScanSegment, scanBuffer } from "./findScan";
import { mouseCursorForceVisible } from "./mouseCursor";
import { type OverlayHandle, pushOverlay } from "./overlayStack";

export type FindBarApi = {
	open(): void;
	close(): void;
	isOpen(): boolean;
	dispose(): void;
};

type Match = ScanMatch;

/** Cap work on pathological scrollbacks; the count still reports the real total. */
const MAX_DECORATIONS = 400;

function scanTerminal(term: Terminal, query: string): Match[] {
	return scanBuffer(term.buffer.active, query, term.cols);
}

export function createFindBar(options: {
	root: HTMLElement;
	getTerminal: () => Terminal | null;
	/** Highlight tints for the focused pane's theme; defaults to the document theme. */
	getHighlightColors?: () => FindHighlightColors;
	island?: CommandIslandApi;
	onClosed?: () => void;
}): FindBarApi {
	const { root, getTerminal, island, onClosed } = options;
	const getHighlightColors =
		options.getHighlightColors ?? (() => terminalFindColors(null));

	root.classList.add("terminal-find");

	const panel = document.createElement("div");
	panel.className = "terminal-find-panel command-island-panel";

	const input = document.createElement("input");
	input.type = "text";
	input.className = "terminal-find-input";
	input.spellcheck = false;
	input.autocomplete = "off";
	input.setAttribute("aria-label", "Find in terminal");

	const count = document.createElement("span");
	count.className = "terminal-find-count";
	count.setAttribute("aria-live", "polite");

	const button = (
		label: string,
		className: string,
		extra?: (b: HTMLButtonElement) => void,
	): HTMLButtonElement => {
		const b = document.createElement("button");
		b.type = "button";
		b.className = className;
		b.setAttribute("aria-label", label);
		extra?.(b);
		return b;
	};

	const closeBtn = button(
		"Close find",
		"terminal-find-btn terminal-find-close",
		(b) => {
			b.textContent = "✕";
		},
	);

	panel.append(input, count, closeBtn);
	root.appendChild(panel);

	let open = false;
	let overlay: OverlayHandle | null = null;
	let matches: Match[] = [];
	let activeIndex = 0;
	let totalMatches = 0;
	const decorations: IDecoration[] = [];
	const markers: IMarker[] = [];
	let writeSub: IDisposable | null = null;
	let rescanTimer = 0;

	function disposeHighlights(): void {
		for (const d of decorations) d.dispose();
		decorations.length = 0;
		for (const m of markers) m.dispose();
		markers.length = 0;
	}

	function updateCount(): void {
		if (totalMatches === 0) {
			count.textContent = input.value ? "0/0" : "";
			return;
		}
		count.textContent = `${activeIndex + 1}/${totalMatches}`;
	}

	function highlight(): void {
		const term = getTerminal();
		disposeHighlights();
		if (!term || matches.length === 0) return;
		// Re-read each pass so a per-pane or custom theme's tints are honored.
		const { match: matchTint, active: activeTint } = getHighlightColors();
		const buf = term.buffer.active;
		const cursorAbsolute = buf.baseY + buf.cursorY;
		const add = (
			segment: ScanSegment,
			highlight: { background: string; foreground: string },
			layer: "bottom" | "top",
		): void => {
			const marker = term.registerMarker(segment.line - cursorAbsolute);
			if (!marker) return;
			markers.push(marker);
			const decoration = term.registerDecoration({
				marker,
				x: segment.start,
				width: segment.length,
				backgroundColor: highlight.background,
				// Forcing the foreground keeps matched glyphs legible even when
				// their own color would blend into the tint.
				foregroundColor: highlight.foreground,
				layer,
			});
			if (decoration) decorations.push(decoration);
		};
		// Cap total decorations, not occurrences: a match that wraps contributes
		// one decoration per visual line.
		let budget = MAX_DECORATIONS;
		for (const match of matches) {
			for (const segment of match.segments) {
				if (budget <= 0) break;
				add(segment, matchTint, "bottom");
				budget--;
			}
			if (budget <= 0) break;
		}
		const current = matches[activeIndex];
		if (current) {
			for (const segment of current.segments) add(segment, activeTint, "top");
		}
	}

	function reveal(scroll: boolean): void {
		const term = getTerminal();
		const match = matches[activeIndex];
		if (!term || !match) return;
		// Decorations mark every match; scrolling is what "locates" the active
		// one. No selection is created, so auto-copy is never triggered.
		if (scroll) term.scrollToLine(match.line);
	}

	function rescan(revealActive: boolean): void {
		const term = getTerminal();
		const query = input.value.trim();
		const previousActive = activeIndex;
		matches = [];
		totalMatches = 0;
		activeIndex = 0;
		if (term && query) {
			matches = scanTerminal(term, query);
			totalMatches = matches.length;
			if (matches.length) {
				if (revealActive) {
					// Prefer the first match at or below the current viewport so a
					// search near the prompt does not yank the user to the top.
					const viewportY = term.buffer.active.viewportY;
					const idx = matches.findIndex((m) => m.line >= viewportY);
					activeIndex = idx >= 0 ? idx : 0;
				} else {
					// A background rescan (terminal output) must not move the
					// viewport; keep the active match roughly in place.
					activeIndex = Math.min(previousActive, matches.length - 1);
				}
			}
		}
		highlight();
		updateCount();
		if (revealActive && matches.length) reveal(true);
	}

	/** Called on explicit next/previous: wraps around the match list. */
	function step(direction: 1 | -1): void {
		if (matches.length === 0) {
			rescan(false);
			if (matches.length === 0) return;
		}
		activeIndex = (activeIndex + direction + matches.length) % matches.length;
		highlight();
		updateCount();
		reveal(true);
	}

	function scheduleRescan(): void {
		if (!open) return;
		if (rescanTimer) window.clearTimeout(rescanTimer);
		rescanTimer = window.setTimeout(() => {
			rescanTimer = 0;
			rescan(false);
		}, 220);
	}

	function onInput(): void {
		rescan(true);
	}

	function onKeyDown(e: KeyboardEvent): void {
		// Enter / F3 cycle forward (Shift reverses); arrow keys do the same so
		// no dedicated prev/next buttons are needed.
		if (
			e.key === "ArrowDown" ||
			e.key === "Enter" ||
			e.key === "F3" ||
			e.key === "ArrowUp"
		) {
			e.preventDefault();
			e.stopPropagation();
			const previous =
				e.key === "ArrowUp" ||
				((e.key === "Enter" || e.key === "F3") && e.shiftKey);
			step(previous ? -1 : 1);
			return;
		}
		e.stopPropagation();
	}

	input.addEventListener("input", onInput);
	input.addEventListener("keydown", onKeyDown);
	closeBtn.addEventListener("click", () => close());

	root.addEventListener("pointerdown", (e) => {
		if (e.target === root) close();
	});

	function attachWriteListener(): void {
		const term = getTerminal();
		if (!term || writeSub) return;
		try {
			writeSub = term.onWriteParsed(() => scheduleRescan());
		} catch {
			writeSub = null;
		}
	}

	function detachWriteListener(): void {
		writeSub?.dispose();
		writeSub = null;
	}

	function openBar(): void {
		if (open) return;
		open = true;
		island?.present("find");
		overlay = pushOverlay(() => close());
		mouseCursorForceVisible(true);
		showSurface(root, "terminal-find--hidden");
		root.setAttribute("aria-hidden", "false");
		attachWriteListener();
		rescan(true);
		requestAnimationFrame(() => {
			input.focus();
			input.select();
		});
	}

	function close(): void {
		if (!open) return;
		open = false;
		overlay?.release();
		overlay = null;
		island?.dismiss("find");
		detachWriteListener();
		if (rescanTimer) {
			window.clearTimeout(rescanTimer);
			rescanTimer = 0;
		}
		disposeHighlights();
		mouseCursorForceVisible(false);
		root.setAttribute("aria-hidden", "true");
		onClosed?.();
		hideSurface(root, "terminal-find--hidden", () => {
			matches = [];
			totalMatches = 0;
			updateCount();
		});
	}

	if (island) {
		island.adopt({
			id: "find",
			element: root,
			hiddenClass: "terminal-find--hidden",
			isOpen: () => open,
			close,
		});
	}

	root.classList.add("terminal-find--hidden");
	root.setAttribute("aria-hidden", "true");

	return {
		open: openBar,
		close,
		isOpen: () => open,
		dispose(): void {
			input.removeEventListener("input", onInput);
			input.removeEventListener("keydown", onKeyDown);
			detachWriteListener();
			if (rescanTimer) window.clearTimeout(rescanTimer);
			disposeHighlights();
			close();
		},
	};
}
