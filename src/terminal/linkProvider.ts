import type {
	IDisposable,
	ILink,
	ILinkDecorations,
	ILinkProvider,
	Terminal,
} from "@xterm/xterm";

import {
	findTerminalLinkMatches,
	type TerminalLinkMatch,
} from "../util/linkExtraction.ts";
import type { PathStyle } from "../util/paths.ts";

const LINK_SCAN_DEBOUNCE_MS = 75;
const MAX_LINK_WINDOW_CELLS = 2048;
const LEADING_WHITESPACE_RE = /^\s/;
const WHITESPACE_RE = /\s/;
let activationModifier = false;
let hoveredDecorations: ILinkDecorations | null = null;

export function setActivationModifier(active: boolean): void {
	activationModifier = active;
	if (hoveredDecorations) hoveredDecorations.pointerCursor = active;
}

if (typeof window !== "undefined") {
	for (const type of ["keydown", "keyup"] as const) {
		window.addEventListener(
			type,
			(event) => setActivationModifier(event.ctrlKey || event.metaKey),
			true,
		);
	}
	window.addEventListener("blur", () => setActivationModifier(false));
}

function clearHover(decorations: ILinkDecorations): void {
	if (hoveredDecorations === decorations) hoveredDecorations = null;
}

/** Apply the shared Ctrl/Meta-dependent hover decoration to a link. */
function decorateLink(link: ILink): ILink {
	const decorations: ILinkDecorations = {
		underline: true,
		pointerCursor: activationModifier,
	};
	link.decorations = decorations;
	const { hover, leave, dispose } = link;
	link.hover = (event, text) => {
		hoveredDecorations = decorations;
		setActivationModifier(event.ctrlKey || event.metaKey);
		hover?.call(link, event, text);
	};
	link.leave = (event, text) => {
		leave?.call(link, event, text);
		clearHover(decorations);
	};
	link.dispose = () => {
		dispose?.call(link);
		clearHover(decorations);
	};
	return link;
}

/** Wrap a provider (e.g. WebLinksAddon's) so its links match the custom ones. */
export function decorateLinkProvider(provider: ILinkProvider): ILinkProvider {
	return {
		provideLinks: (line, callback) =>
			provider.provideLinks(line, (links) =>
				callback(links?.map(decorateLink)),
			),
	};
}

export type TerminalLinkProviderController = {
	invalidate: () => void;
	scheduleViewportPrewarm: () => void;
	dispose: () => void;
};

export type TerminalLinkProviderOptions = {
	getCwd: () => string | null;
	getPathStyle?: () => PathStyle;
	isFocused: () => boolean;
	activate: (event: MouseEvent, match: TerminalLinkMatch) => void;
};

type CellPosition = {
	x: number;
	y: number;
	width: number;
};

type LogicalLineWindow = {
	top: number;
	bottom: number;
	text: string;
	positions: CellPosition[];
};

type CachedLink = {
	range: ILink["range"];
	match: TerminalLinkMatch;
};

export function registerTerminalLinkProvider(
	term: Terminal,
	options: TerminalLinkProviderOptions,
): TerminalLinkProviderController {
	const rowCache = new Map<number, CachedLink[] | undefined>();
	let debounceTimer: number | null = null;
	let scanFrame: number | null = null;
	let disposed = false;

	const cacheLogicalLine = (
		bufferRow: number,
		logical = readLogicalLineWindow(term, bufferRow),
	): void => {
		if (!logical) {
			rowCache.set(bufferRow + 1, undefined);
			return;
		}

		const linksByRow = new Map<number, CachedLink[]>();
		const matches = findTerminalLinkMatches(
			logical.text,
			options.getCwd(),
			options.getPathStyle?.(),
		);
		for (const match of matches) {
			const start = logical.positions[match.start];
			const end = logical.positions[match.end - 1];
			if (!(start && end)) continue;
			const link: CachedLink = {
				range: {
					start: { x: start.x + 1, y: start.y + 1 },
					end: { x: end.x + Math.max(1, end.width), y: end.y + 1 },
				},
				match,
			};
			for (let row = start.y; row <= end.y; row++) {
				const links = linksByRow.get(row) ?? [];
				links.push(link);
				linksByRow.set(row, links);
			}
		}

		// A window is centred on the requested row; neighbouring rows may need
		// more context than this window includes.
		rowCache.set(bufferRow + 1, linksByRow.get(bufferRow));
	};

	const scanViewport = (): void => {
		if (disposed || !options.isFocused()) return;
		rowCache.clear();
		const buffer = term.buffer.active;
		const first = buffer.viewportY;
		const last = Math.min(buffer.length - 1, first + term.rows - 1);
		let row = first;
		while (row <= last) {
			const logical = readLogicalLineWindow(term, row);
			if (!logical) {
				rowCache.set(row + 1, undefined);
				row++;
				continue;
			}
			cacheLogicalLine(row, logical);
			row++;
		}
	};

	const cancelScheduledScan = (): void => {
		if (debounceTimer !== null) {
			window.clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		if (scanFrame !== null) {
			cancelAnimationFrame(scanFrame);
			scanFrame = null;
		}
	};

	const scheduleViewportPrewarm = (): void => {
		if (disposed || !options.isFocused()) return;
		if (debounceTimer !== null) window.clearTimeout(debounceTimer);
		if (scanFrame !== null) {
			cancelAnimationFrame(scanFrame);
			scanFrame = null;
		}
		debounceTimer = window.setTimeout(() => {
			debounceTimer = null;
			scanFrame = requestAnimationFrame(() => {
				scanFrame = null;
				scanViewport();
			});
		}, LINK_SCAN_DEBOUNCE_MS);
	};

	const invalidate = (): void => {
		rowCache.clear();
		scheduleViewportPrewarm();
	};

	const provider: ILinkProvider = {
		provideLinks(bufferLineNumber, callback) {
			if (!rowCache.has(bufferLineNumber)) {
				// Hover must remain responsive while a trailing viewport scan is
				// waiting, so synchronously scan only the requested logical line.
				cacheLogicalLine(bufferLineNumber - 1);
			}
			const cached = rowCache.get(bufferLineNumber);
			callback(
				cached?.map((cachedLink) =>
					decorateLink({
						range: cachedLink.range,
						text: cachedLink.match.text,
						activate: (event) => options.activate(event, cachedLink.match),
					}),
				),
			);
		},
	};

	const subscriptions: IDisposable[] = [
		term.registerLinkProvider(provider),
		term.onWriteParsed(invalidate),
		term.onScroll(invalidate),
		term.onResize(invalidate),
		term.buffer.onBufferChange(invalidate),
	];

	scheduleViewportPrewarm();

	return {
		invalidate,
		scheduleViewportPrewarm,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			cancelScheduledScan();
			rowCache.clear();
			for (const subscription of subscriptions) subscription.dispose();
		},
	};
}

function readLogicalLineWindow(
	term: Terminal,
	requestedRow: number,
): LogicalLineWindow | null {
	const buffer = term.buffer.active;
	if (requestedRow < 0 || requestedRow >= buffer.length) return null;

	// Like WebLinksAddon, stop expanding at whitespace as well as a size
	// budget. TUIs can leave isWrapped set across otherwise unrelated rows.
	let top = requestedRow;
	let traversed = 0;
	while (top > 0 && traversed < MAX_LINK_WINDOW_CELLS) {
		const line = buffer.getLine(top);
		if (
			!line?.isWrapped ||
			LEADING_WHITESPACE_RE.test(line.translateToString(true))
		)
			break;
		top--;
		const content = buffer.getLine(top)?.translateToString(true) ?? "";
		traversed += Math.max(1, term.cols);
		if (WHITESPACE_RE.test(content)) break;
	}

	let bottom = requestedRow;
	traversed = 0;
	while (bottom + 1 < buffer.length && traversed < MAX_LINK_WINDOW_CELLS) {
		const next = buffer.getLine(bottom + 1);
		if (!next?.isWrapped) break;
		bottom++;
		traversed += Math.max(1, term.cols);
		if (WHITESPACE_RE.test(next.translateToString(true))) break;
	}

	const text: string[] = [];
	const positions: CellPosition[] = [];
	const cell = buffer.getNullCell();
	for (let row = top; row <= bottom; row++) {
		const line = buffer.getLine(row);
		if (!line) break;
		for (let col = 0; col < Math.min(term.cols, line.length); col++) {
			line.getCell(col, cell);
			const width = cell.getWidth();
			if (!width) continue;
			// xterm leaves a null cell when a wide character wraps early. It
			// is padding, not a space in the path. Preserve real printed spaces.
			if (
				col === term.cols - 1 &&
				!cell.getChars() &&
				row < bottom &&
				buffer
					.getLine(row + 1)
					?.getCell(0)
					?.getWidth() === 2
			)
				continue;
			const chars = cell.getChars() || " ";
			for (let i = 0; i < chars.length; i++) {
				text.push(chars[i]);
				positions.push({ x: col, y: row, width });
			}
		}
	}

	return { top, bottom, text: text.join(""), positions };
}
