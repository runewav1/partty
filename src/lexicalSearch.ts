/**
 * Shared query tokenization + ranked matching for palettes / theme pickers.
 * Parts may match as substrings or as prefixes of label/id tokens
 * (e.g. "git dark" → "GitHub — Dark").
 */

export function normalizeQuery(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export type LexicalSearchItem = {
  label: string;
  /** Extra searchable text (not shown). */
  keywords?: string;
  id?: string;
};

function partMatches(part: string, hay: string, tokens: string[]): boolean {
  if (hay.includes(part)) return true;
  return tokens.some((t) => t.startsWith(part));
}

/**
 * Rank a match so shorter / label-primary hits win.
 * Returns null when the item does not match.
 */
export function scoreLexicalMatch(
  item: LexicalSearchItem,
  parts: string[],
): number | null {
  if (parts.length === 0) return 0;
  const label = item.label.toLowerCase();
  const keywords = (item.keywords ?? "").toLowerCase();
  const idTokens = item.id ? tokenize(item.id) : [];
  const labelTokens = tokenize(label);
  const keywordTokens = tokenize(keywords);
  const allTokens = [...labelTokens, ...keywordTokens, ...idTokens];
  const hay = `${label} ${keywords} ${idTokens.join(" ")}`;

  if (!parts.every((p) => partMatches(p, hay, allTokens))) return null;

  const q = parts.join(" ");
  let score = 0;

  if (label === q) score += 10_000;
  else if (label.startsWith(q)) score += 5_000;

  if (parts.every((p) => partMatches(p, label, labelTokens))) {
    score += 2_000;
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
  return all
    .map((item) => ({ item, score: scoreLexicalMatch(item, parts) }))
    .filter((row): row is { item: T; score: number } => row.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.label.length - b.item.label.length ||
        a.item.label.localeCompare(b.item.label),
    )
    .map((row) => row.item);
}
