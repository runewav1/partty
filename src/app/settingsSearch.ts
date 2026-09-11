/**
 * Pure query matching for the settings panel.
 *
 * Every preference is rendered as one `.settings-item`; the DOM wiring in
 * `settingsPanel.ts` folds each item into a {@link SettingsItemMeta} and this
 * module decides which items survive a query. Matching reuses the shared
 * lexical semantics (case-insensitive, separator-normalized, substring or
 * token-prefix, multi-token AND) so settings behave like the command palette.
 *
 * Kept DOM-free so it can be unit tested under node --experimental-strip-types.
 */

import {
	filterAndRankLexical,
	type LexicalSearchItem,
	normalizeQuery,
} from "../util/lexicalSearch.ts";

export type SettingsItemMeta = {
	/** Visible label text. */
	label: string;
	/** Hidden synonyms / aliases (`data-keywords`). */
	keywords?: string;
	/** Preference name (`data-pref`, e.g. `terminal_font_size`). */
	pref?: string;
	/** Description shown below the control. */
	desc?: string;
	/** Control identifiers: name/id/placeholder plus option text and title. */
	controlText?: string;
};

const SEPARATORS_RE = /[_-]+/g;

/**
 * Fold every searchable field into one lowercase, separator-normalized string.
 * Exposed for tests/debugging; the matcher matches against the same fields.
 */
export function settingsItemText(item: SettingsItemMeta): string {
	return [item.pref, item.keywords, item.label, item.desc, item.controlText]
		.filter((part): part is string => Boolean(part))
		.join(" ")
		.toLowerCase()
		.replace(SEPARATORS_RE, " ");
}

type WrappedItem<T> = LexicalSearchItem & { item: T };

/**
 * Return the items matching `rawQuery`, best matches first. An empty/blank
 * query matches every item so callers can restore the normal tab view.
 */
export function filterSettingsItems<T extends SettingsItemMeta>(
	items: readonly T[],
	rawQuery: string,
): T[] {
	const parts = normalizeQuery(rawQuery.replace(SEPARATORS_RE, " "));
	if (parts.length === 0) return [...items];
	const wrapped: WrappedItem<T>[] = items.map((item) => ({
		label: item.label,
		keywords: [item.keywords, item.desc, item.controlText]
			.filter((part): part is string => Boolean(part))
			.join(" "),
		id: item.pref,
		item,
	}));
	return filterAndRankLexical(wrapped, parts).map((entry) => entry.item);
}
