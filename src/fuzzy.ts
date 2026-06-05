/** Subsequence fuzzy score; higher is better. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q.length) return 1;
  if (!t.length) return 0;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      streak++;
      score += 10 + streak;
      qi++;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : 0;
}

export function fuzzyRank<T>(items: T[], query: string, textOf: (t: T) => string): T[] {
  if (!query.trim()) return items.slice();
  const scored = items
    .map((item) => ({ item, s: fuzzyScore(query, textOf(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.map((x) => x.item);
}
