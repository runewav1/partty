import { expandRelativePath, type PathStyle } from "./paths.ts";

export type TerminalLinkMatch = {
	kind: "url" | "path";
	start: number;
	end: number;
	text: string;
	value: string;
};

// Scheme-less web hosts only. Schemed http(s) URLs are owned by the official
// WebLinksAddon, which applies its own URL boundary rules (it excludes some
// punctuation, e.g. parentheses). The addon's internal `isUrl` gate requires a
// scheme, so `www.`/bare localhost/loopback stay here as a narrow fallback.
const SCHEMELESS_URL_RE =
	/(?:www\.[^\s<>"'`]*|(?:localhost|127\.0\.0\.1):\d+[^\s<>"'`]*|\[::1\]:\d+[^\s<>"'`]*|::1:\d+[^\s<>"'`]*)/gi;
// Consume whole tokens so URLs, flags and prose cannot expose path-shaped substrings.
const PATH_TOKEN_RE = /"([^"\r\n]+)"|'([^'\r\n]+)'|[^\s"'<>`]+/g;
// Applied only to scheme-less prose candidates; schemed links stay exact.
const URL_TRAILING_PUNCTUATION_RE = /[),.;:!?]+$/g;
const HTTP_SCHEME_RE = /^https?:\/\//i;
const WWW_RE = /^www\./i;
const LOCALHOST_RE = /^localhost:\d+(?:[^\s<>"'`]*)?$/i;
const LOOPBACK_RE = /^(?:127\.0\.0\.1|\[::1\]|::1):\d+(?:[^\s<>"'`]*)?$/i;
const ROOTED_PATH_RE = /^[\\/]/;
const DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/;
const SCHEME_PATH_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
// A real URL scheme inside a whitespace-delimited token (exclude the drive-letter
// `C://` form so those are not mistaken for schemes).
const SCHEME_IN_TOKEN_RE = /(?![A-Za-z]:\/\/)[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const UNC_PATH_RE = /^\\\\|^\/\//;
const POSIX_ROOT_PATH_RE =
	/^\/(?:home|Users|usr|etc|var|tmp|opt|mnt|root|dev|proc|sys|bin|lib|sbin|boot|media|run|snap|srv|Volumes|workspace)(?:\/|$)/;
const WHITESPACE_RE = /\s/;

/**
 * Validate an exact URL without prose punctuation stripping. Used for the
 * WebLinksAddon handler and OSC 8 hyperlinks, where the link boundary is
 * already resolved and validation must not rewrite it (OSC 8 in particular can
 * carry balanced parentheses). Scheme-less prose is trimmed by the caller
 * before reaching here.
 */
export function normalizeExactExternalUrl(value: string): string | null {
	const raw = value.trim();
	if (!raw) return null;

	const hasHttpScheme = HTTP_SCHEME_RE.test(raw);
	const isWww = WWW_RE.test(raw);
	// Keep this allowlist aligned with the native open_external_url command.
	const isLocalhost = LOCALHOST_RE.test(raw);
	const isLoopback = LOOPBACK_RE.test(raw);
	if (!(hasHttpScheme || isWww || isLocalhost || isLoopback)) return null;

	const normalized = hasHttpScheme ? raw : `https://${raw}`;
	try {
		const url = new URL(normalized);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

/** True when the whitespace-delimited token containing `index` has a scheme. */
function isInsideSchemedUrl(line: string, index: number): boolean {
	let start = index;
	while (start > 0 && !WHITESPACE_RE.test(line[start - 1])) start--;
	let end = index;
	while (end < line.length && !WHITESPACE_RE.test(line[end])) end++;
	return SCHEME_IN_TOKEN_RE.test(line.slice(start, end));
}

export function findTerminalLinkMatches(
	line: string,
	cwd: string | null,
	style?: PathStyle,
): TerminalLinkMatch[] {
	const matches: TerminalLinkMatch[] = [];

	// Narrow scheme-less fallback, before paths so `addPathMatch` dedupes any
	// path fragments that overlap one of these hosts (e.g. `www.x.com/foo`).
	for (const m of line.matchAll(SCHEMELESS_URL_RE)) {
		if (m.index > 0 && /[\w@./\\-]/.test(line[m.index - 1])) continue;
		if (isInsideSchemedUrl(line, m.index)) continue;
		// Scheme-less prose: trim trailing sentence punctuation before validating.
		const text = m[0].replace(URL_TRAILING_PUNCTUATION_RE, "");
		const value = normalizeExactExternalUrl(text);
		if (!(text && value)) continue;
		matches.push({
			kind: "url",
			start: m.index,
			end: m.index + text.length,
			text,
			value,
		});
	}

	for (const m of line.matchAll(PATH_TOKEN_RE)) {
		const quoted = m[1] ?? m[2];
		const leading = quoted === undefined ? m[0].match(/^[([{]+/)?.[0].length ?? 0 : 1;
		const start = m.index + leading;
		const raw = quoted ?? trimPathToken(m[0].slice(leading));
		if (!raw || isInsideSchemedUrl(line, start)) continue;
		const absolute = isAbsolutePath(raw, quoted !== undefined);
		if (!absolute && !(cwd && isRelativePathCandidate(raw, quoted !== undefined))) continue;
		addPathMatch(matches, {
			kind: "path",
			start,
			end: start + raw.length,
			text: raw,
			value: absolute ? raw : expandRelativePath(raw, cwd!, style),
		});
	}
	return matches.sort((a, b) => a.start - b.start || a.end - b.end);
}

function trimPathToken(token: string): string {
	let raw = token.replace(/[.,;:!?]+$/, "");
	// Remove prose wrappers only when unmatched; brackets can be part of a filename.
	for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
		while (raw.endsWith(close) && raw.split(close).length > raw.split(open).length) {
			raw = raw.slice(0, -1);
		}
	}
	// Diagnostic positions are not part of the filesystem path.
	return raw.replace(/(?::\d+(?::\d+)?|\(\d+(?:,\s*\d+)?\))$/, "");
}

function isRelativePathCandidate(tok: string, quoted: boolean): boolean {
	if (ROOTED_PATH_RE.test(tok)) return false; // absolute / UNC — handled elsewhere
	if (DRIVE_PATH_RE.test(tok)) return false; // drive absolute
	if (SCHEME_PATH_RE.test(tok)) return false; // URL
	if (/^[~\-]|[\x00-\x1f<>|=*?]|^[^\\/]*[:@]/.test(tok)) return false;
	if (/^\.{1,2}[\\/]/.test(tok)) return true;
	const parts = tok.split(/[\\/]/);
	if (parts.length < 2 || parts.some((part, i) => !part && i < parts.length - 1)) return false;
	// Dates, fractions, MIME types and ordinary alternatives are common output.
	if (parts.every((part) => /^\d+$/.test(part))) return false;
	if (/^(?:application|audio|font|image|message|model|multipart|text|video)\//i.test(tok)) return false;
	return quoted || tok.endsWith("/") || tok.endsWith("\\") ||
		/^(?:src|lib|bin|test|tests|spec|docs|build|dist|packages|node_modules|\.git)[\\/]/.test(tok) ||
		/\.[\p{L}\d_+-]+$/u.test(parts.at(-1)!);
}

function isAbsolutePath(path: string, quoted: boolean): boolean {
	if (/[\x00-\x1f<>|]/.test(path)) return false;
	return (
		DRIVE_PATH_RE.test(path) ||
		(UNC_PATH_RE.test(path) && /^(?:\\\\|\/\/)[^\\/\s]+[\\/][^\\/\s]+/.test(path)) ||
		path.startsWith("~/") ||
		POSIX_ROOT_PATH_RE.test(path) ||
		(/^\/(?!\/)/.test(path) && (quoted || path.slice(1).includes("/") || /\.[\p{L}\d]+$/u.test(path)))
	);
}

function addPathMatch(
	matches: TerminalLinkMatch[],
	path: TerminalLinkMatch,
): void {
	if (!matches.some((m) => path.start < m.end && m.start < path.end)) {
		matches.push(path);
	}
}
