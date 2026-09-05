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
} from "../util/linkExtraction";

const LINK_SCAN_DEBOUNCE_MS = 75;
const MAX_LINK_WINDOW_CELLS = 2048;
let activationModifier = false;
let hoveredDecorations: ILinkDecorations | null = null;

function setActivationModifier(active: boolean): void {
	activationModifier = active;
	if (hoveredDecorations) hoveredDecorations.pointerCursor = active;
}

for (const type of ["keydown", "keyup"] as const) {
	window.addEventListener(
		type,
		(event) => setActivationModifier(event.ctrlKey || event.metaKey),
		true,
	);
}
window.addEventListener("blur", () => setActivationModifier(false));

export type TerminalLinkProviderController = {
	invalidate: () => void;
	scheduleViewportPrewarm: () => void;
	dispose: () => void;
};

export type TerminalLinkProviderOptions = {
	getCwd: () => string | null;
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
		const matches = findTerminalLinkMatches(logical.text, options.getCwd());
		for (const match of matches) {
			const start = logical.positions[match.start];
			const end = logical.positions[match.end - 1];
			if (!start || !end) continue;
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

		for (let row = logical.top; row <= logical.bottom; row++) {
			rowCache.set(row + 1, linksByRow.get(row));
		}
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
			row = Math.max(row + 1, logical.bottom + 1);
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
				cached?.map((cachedLink) => {
					const clearHover = () => {
						if (hoveredDecorations === link.decorations)
							hoveredDecorations = null;
					};
					const link: ILink = {
						range: cachedLink.range,
						text: cachedLink.match.text,
						decorations: {
							underline: true,
							pointerCursor: activationModifier,
						},
						activate: (event) => options.activate(event, cachedLink.match),
						hover: (event) => {
							hoveredDecorations = link.decorations ?? null;
							setActivationModifier(event.ctrlKey || event.metaKey);
						},
						leave: clearHover,
						dispose: clearHover,
					};
					return link;
				}),
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

	const maxRowsPerDirection = Math.max(
		1,
		Math.ceil(MAX_LINK_WINDOW_CELLS / term.cols) + 1,
	);
	let top = requestedRow;
	let traversed = 0;
	while (top > 0 && traversed < maxRowsPerDirection) {
		const line = buffer.getLine(top);
		if (!line?.isWrapped) break;
		top--;
		traversed++;
	}

	let bottom = requestedRow;
	traversed = 0;
	while (bottom + 1 < buffer.length && traversed < maxRowsPerDirection) {
		const next = buffer.getLine(bottom + 1);
		if (!next?.isWrapped) break;
		bottom++;
		traversed++;
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
			const chars = cell.getChars() || " ";
			for (let i = 0; i < chars.length; i++) {
				text.push(chars[i]);
				positions.push({ x: col, y: row, width });
			}
		}
	}

	return { top, bottom, text: text.join(""), positions };
}
