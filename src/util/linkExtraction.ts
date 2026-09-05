import { expandRelativePath } from "./paths";

export type TerminalLinkMatch = {
	kind: "url" | "path";
	start: number;
	end: number;
	text: string;
	value: string;
};

const URL_RE =
	/(?:https?:\/\/|www\.)[^\s<>"'`]+|(?:localhost|127\.0\.0\.1):\d+[^\s<>"'`]*|\[::1\]:\d+[^\s<>"'`]*|::1:\d+[^\s<>"'`]*/gi;
const ABSOLUTE_PATH_RE =
	/(?:"([^"\n]+)"|'([^'\n]+)'|(?:\\\\|\/\/)[^\s<>"'`]+|[A-Za-z]:[\\/][^\s<>"'`]+|~\/[^\s<>"'`]+|\/(?:home|Users|usr|etc|var|tmp|opt|mnt|root|dev|proc|sys|bin|lib|sbin|boot|media|run|snap)(?:\/[^\s<>"'`]*)?)/g;
const TOKEN_RE = /\S+/g;
const TRAILING_PUNCTUATION_RE = /[),.;:!?\]]+$/g;
const URL_TRAILING_PUNCTUATION_RE = /[),.;:!?]+$/g;
const HTTP_SCHEME_RE = /^https?:\/\//i;
const WWW_RE = /^www\./i;
const LOCALHOST_RE = /^localhost:\d+(?:[^\s<>"'`]*)?$/i;
const LOOPBACK_RE = /^(?:127\.0\.0\.1|\[::1\]|::1):\d+(?:[^\s<>"'`]*)?$/i;
const ROOTED_PATH_RE = /^[\\/]/;
const DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/;
const SCHEME_PATH_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const DOT_PATH_RE = /^\.{1,2}$/;
const UNC_PATH_RE = /^\\\\|^\/\//;
const POSIX_ROOT_PATH_RE =
	/^\/(?:home|Users|usr|etc|var|tmp|opt|mnt|root|dev|proc|sys|bin|lib|sbin|boot|media|run|snap)(?:\/|$)/;

export function normalizeExternalUrl(value: string): string | null {
	const raw = value.trim().replace(URL_TRAILING_PUNCTUATION_RE, "");
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

export function findTerminalLinkMatches(
	line: string,
	cwd: string | null,
): TerminalLinkMatch[] {
	const matches: TerminalLinkMatch[] = [];
	for (const m of line.matchAll(URL_RE)) {
		const text = m[0].replace(URL_TRAILING_PUNCTUATION_RE, "");
		const value = normalizeExternalUrl(text);
		if (!(text && value)) continue;
		matches.push({
			kind: "url",
			start: m.index,
			end: m.index + text.length,
			text,
			value,
		});
	}

	for (const m of line.matchAll(ABSOLUTE_PATH_RE)) {
		const quoted = m[1] ?? m[2];
		const raw = (quoted ?? m[0]).replace(TRAILING_PUNCTUATION_RE, "");
		if (!raw) continue;
		if (quoted && !isAbsolutePath(raw)) continue;
		const quoteOffset = quoted ? 1 : 0;
		addPathMatch(matches, {
			kind: "path",
			start: m.index + quoteOffset,
			end: m.index + quoteOffset + raw.length,
			text: raw,
			value: raw,
		});
	}

	if (cwd) {
		for (const m of line.matchAll(TOKEN_RE)) {
			const raw = m[0].replace(TRAILING_PUNCTUATION_RE, "");
			if (!isRelativePathCandidate(raw)) continue;
			addPathMatch(matches, {
				kind: "path",
				start: m.index,
				end: m.index + raw.length,
				text: raw,
				value: expandRelativePath(raw, cwd),
			});
		}
	}
	return matches.sort((a, b) => a.start - b.start || a.end - b.end);
}

function isRelativePathCandidate(tok: string): boolean {
	if (ROOTED_PATH_RE.test(tok)) return false; // absolute / UNC — handled elsewhere
	if (DRIVE_PATH_RE.test(tok)) return false; // drive absolute
	if (SCHEME_PATH_RE.test(tok)) return false; // URL
	if (!(tok.includes("/") || tok.includes("\\"))) return false; // needs a separator
	if (DOT_PATH_RE.test(tok)) return false;
	return true;
}

function isAbsolutePath(path: string): boolean {
	return (
		DRIVE_PATH_RE.test(path) ||
		UNC_PATH_RE.test(path) ||
		path.startsWith("~/") ||
		POSIX_ROOT_PATH_RE.test(path)
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
