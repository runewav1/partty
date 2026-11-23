import type { IBuffer, Terminal } from "@xterm/xterm";

export const COLLAPSED_MATCHES = 3;
export const MAX_MATCH_PREVIEWS = 100;

export type ScrollbackMatch = {
	buffer: IBuffer["type"];
	row: number;
	rowText: string;
	before: string;
	text: string;
	after: string;
};

export type ScrollbackHits = { count: number; matches: ScrollbackMatch[] };

/** Search the visible TUI first, then capped normal history. */
export function* scanScrollback(
	term: Terminal,
	depth: number,
	phrase: string,
): Generator<undefined, ScrollbackHits> {
	const hits: ScrollbackHits = { count: 0, matches: [] };
	if (!depth || !phrase) return hits;
	const pattern = new RegExp(
		phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		"giu",
	);
	const active = term.buffer.active;
	if (active.type === "alternate") {
		yield* scanBuffer(term, active, term.rows, pattern, hits);
	}
	yield* scanBuffer(term, term.buffer.normal, depth, pattern, hits);
	return hits;
}

function* scanBuffer(
	term: Terminal,
	buffer: IBuffer,
	depth: number,
	pattern: RegExp,
	hits: ScrollbackHits,
): Generator<undefined> {
	const end = buffer.length;
	const start = Math.max(0, end - depth);
	const cols = term.cols;
	let remaining = 128;
	for (let row = end - 1; row >= start; ) {
		const bottom = row;
		const chunks: string[] = [];
		let wrapped: boolean;
		do {
			const line = buffer.getLine(row);
			wrapped = line?.isWrapped ?? false;
			// Retain printed spaces at soft wraps; omit the empty cell before an early wide-character wrap.
			const last = row < bottom ? line?.getCell(cols - 1) : undefined;
			const earlyWide =
				last?.getCode() === 0 &&
				buffer
					.getLine(row + 1)
					?.getCell(0)
					?.getWidth() === 2;
			chunks.push(
				line?.translateToString(row === bottom, 0, cols - Number(earlyWide)) ??
					"",
			);
			row--;
			if (--remaining === 0 && row >= start) {
				remaining = 128;
				yield;
				if (term.cols !== cols || buffer.length < end) return;
			}
		} while (wrapped && row >= start);
		if (chunks.length === 1 && !chunks[0]) continue;
		chunks.reverse();
		const text = chunks.join("");
		let part = 0;
		let offset = 0;
		pattern.lastIndex = 0;
		for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
			hits.count++;
			if (hits.matches.length === MAX_MATCH_PREVIEWS) continue;
			const index = match.index;
			while (
				part + 1 < chunks.length &&
				index >= offset + chunks[part]!.length
			) {
				offset += chunks[part++]!.length;
			}
			const hitRow = row + 1 + part;
			const limit = index + match[0].length;
			hits.matches.push({
				buffer: buffer.type,
				row: hitRow,
				rowText: buffer.getLine(hitRow)?.translateToString(true, 0, cols) ?? "",
				before: `${index > 48 ? "…" : ""}${text.slice(Math.max(0, index - 48), index)}`,
				text: match[0],
				after: `${text.slice(limit, limit + 64)}${limit + 64 < text.length ? "…" : ""}`,
			});
		}
	}
}
