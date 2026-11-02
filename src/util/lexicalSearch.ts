/**
 * Shared query tokenization + ranked matching for palettes / theme pickers.
 * Parts may match as substrings or as prefixes of label/id tokens
 * (e.g. "git dark" → "GitHub — Dark").
 */

const WHITESPACE_RE = /\s+/;
const NON_ALPHANUMERIC_RE = /[^a-z0-9]+/;

export function normalizeQuery(raw: string): string[] {
	return raw.trim().toLowerCase().split(WHITESPACE_RE).filter(Boolean);
}

function tokenize(s: string): string[] {
	return s.toLowerCase().split(NON_ALPHANUMERIC_RE).filter(Boolean);
}

export type LexicalSearchItem = {
	label: string;
	/** Extra searchable text (not shown). */
	keywords?: string;
	id?: string;
};

/**
 * Rank a match so shorter / label-primary hits win.
 * Returns null when the item does not match.
 */
function scoreLexicalMatch(
	item: LexicalSearchItem,
	parts: string[],
	query: string,
): number | null {
	const label = item.label.toLowerCase();
	const keywords = (item.keywords ?? "").toLowerCase();
	const idTokens = item.id ? tokenize(item.id) : [];
	const labelTokens = tokenize(label);
	const keywordTokens = tokenize(keywords);
	const hay = `${label} ${keywords} ${idTokens.join(" ")}`;

	if (!parts.every((p) => hay.includes(p))) return null;

	let score = 0;

	if (label === query) score += 10_000;
	else if (label.startsWith(query)) score += 5000;

	if (parts.every((p) => label.includes(p))) {
		score += 2000;
		score += Math.max(0, 400 - labelTokens.length * 80);
		const covered = labelTokens.filter((w) =>
			parts.some((p) => w === p || w.startsWith(p)),
		).length;
		score += Math.round((covered / Math.max(labelTokens.length, 1)) * 400);
	} else {
		score += 150;
	}

	for (const p of parts) {
		if (labelTokens.some((w) => w === p)) score += 100;
		else if (labelTokens.some((w) => w.startsWith(p))) score += 60;
		else if (label.includes(p)) score += 25;
		else if (idTokens.some((w) => w === p || w.startsWith(p))) score += 15;
		else if (keywordTokens.some((w) => w === p || w.startsWith(p))) score += 10;
		else score += 5;
	}

	return score - Math.min(label.length, 40);
}

export function filterAndRankLexical<T extends LexicalSearchItem>(
	all: readonly T[],
	parts: string[],
): T[] {
	if (parts.length === 0) return [...all];
	const query = parts.join(" ");
	return all
		.map((item) => ({ item, score: scoreLexicalMatch(item, parts, query) }))
		.filter((row): row is { item: T; score: number } => row.score !== null)
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.item.label.length - b.item.label.length ||
				a.item.label.localeCompare(b.item.label),
		)
		.map((row) => row.item);
}
