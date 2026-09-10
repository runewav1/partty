/**
 * Pure, DOM-free scrollback scan for the terminal find bar.
 *
 * xterm exposes the buffer as cells. A naive `translateToString` search treats
 * JS string indices as cell columns, which breaks wide glyphs (a CJK char is one
 * JS char but occupies two cells) and misses matches that span a soft-wrapped
 * logical line. This module walks cells directly, maps matches back to cell
 * coordinates, and splits wrapped matches into per-visual-line segments so each
 * decoration is valid. Kept dependency-free so it is unit-testable in node.
 */

export type ScanSegment = {
	/** Absolute buffer line. */
	line: number;
	/** Start column in cells. */
	start: number;
	/** Segment length in cells. */
	length: number;
};

export type ScanMatch = {
	/** Absolute buffer line of the first segment (scroll target). */
	line: number;
	/** One or more visual-line segments; more than one when the match wraps. */
	segments: ScanSegment[];
};

/** Structural subset of xterm's `IBufferCell`. */
export type ScanCell = { getWidth(): number; getChars(): string };
/** Structural subset of xterm's `IBufferLine`. */
export type ScanLine = {
	readonly isWrapped: boolean;
	readonly length: number;
	getCell(x: number): ScanCell | undefined;
};
/** Structural subset of xterm's `IBuffer`. */
export type ScanBuffer = {
	readonly length: number;
	getLine(y: number): ScanLine | undefined;
};

type CellRef = { line: number; x: number; width: number; chars: string };

function buildMatch(
	cells: CellRef[],
	startCell: number,
	endCell: number,
): ScanMatch {
	const segments: ScanSegment[] = [];
	let current: ScanSegment | null = null;
	for (let i = startCell; i <= endCell; i++) {
		const c = cells[i];
		if (!c) continue;
		if (!current || current.line !== c.line) {
			current = { line: c.line, start: c.x, length: c.width };
			segments.push(current);
		} else {
			current.length = c.x + c.width - current.start;
		}
	}
	return { line: segments[0]?.line ?? 0, segments };
}

function scanGroup(
	group: ScanLine[],
	firstLine: number,
	needle: string,
	maxCols: number,
	out: ScanMatch[],
): void {
	const cells: CellRef[] = [];
	for (let i = 0; i < group.length; i++) {
		const line = group[i]!;
		const end = Math.min(line.length, maxCols);
		for (let x = 0; x < end; x++) {
			const cell = line.getCell(x);
			if (!cell) continue;
			const width = cell.getWidth();
			// Width-0 cells are the trailing half of a wide glyph; the glyph's
			// first cell already accounts for those columns.
			if (width <= 0) continue;
			cells.push({
				line: firstLine + i,
				x,
				width,
				chars: cell.getChars() || " ",
			});
		}
	}
	if (cells.length === 0) return;

	let joined = "";
	const charToCell: number[] = [];
	for (let i = 0; i < cells.length; i++) {
		const lower = cells[i]!.chars.toLowerCase();
		joined += lower;
		for (let k = 0; k < lower.length; k++) charToCell.push(i);
	}

	let index = joined.indexOf(needle);
	while (index !== -1) {
		const startCell = charToCell[index];
		const endCell = charToCell[index + needle.length - 1];
		if (startCell !== undefined && endCell !== undefined) {
			out.push(buildMatch(cells, startCell, endCell));
		}
		index = joined.indexOf(needle, index + needle.length);
	}
}

/**
 * Scan the whole buffer for `query` (case-insensitive), returning cell-accurate
 * matches. `maxCols` bounds each visual line (use `Terminal.cols`).
 */
export function scanBuffer(
	buffer: ScanBuffer,
	query: string,
	maxCols?: number,
): ScanMatch[] {
	const needle = query.toLowerCase();
	if (!needle) return [];
	const matches: ScanMatch[] = [];
	const total = buffer.length;
	const cols = maxCols && maxCols > 0 ? maxCols : Number.POSITIVE_INFINITY;
	let y = 0;
	while (y < total) {
		const first = buffer.getLine(y);
		if (!first) {
			y++;
			continue;
		}
		const group: ScanLine[] = [first];
		let next = y + 1;
		while (next < total) {
			const line = buffer.getLine(next);
			if (!line?.isWrapped) break;
			group.push(line);
			next++;
		}
		scanGroup(group, y, needle, cols, matches);
		y = next;
	}
	return matches;
}
