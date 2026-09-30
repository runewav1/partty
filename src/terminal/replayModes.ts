import type { Terminal } from "@xterm/xterm";

/**
 * SerializeAddon restores mouse tracking but omits its report encoding. Keep
 * the encoding as well, otherwise a rehydrated TUI expecting SGR wheel reports
 * receives legacy reports instead. The fork exposes this only through its core.
 */
export function serializeReplayMouseEncoding(term: Terminal): string {
	const core = (
		term as unknown as {
			_core?: { mouseStateService?: { activeEncoding?: string } };
		}
	)._core;
	switch (core?.mouseStateService?.activeEncoding) {
		case "SGR":
			return "\x1b[?1006h";
		case "SGR_PIXELS":
			return "\x1b[?1016h";
		default:
			return "";
	}
}
