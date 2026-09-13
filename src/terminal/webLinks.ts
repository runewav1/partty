import { WebLinksAddon } from "@xterm/addon-web-links";
import type { IDisposable, ILinkProvider, Terminal } from "@xterm/xterm";

import { decorateLinkProvider } from "./linkProvider.ts";

/**
 * Load the official WebLinksAddon, decorating the provider it registers so
 * hover follows the custom provider's Ctrl/Meta policy. The addon only exposes
 * `WebLinksAddon`, so a prototype-inherited facade forwards its single
 * `registerLinkProvider` call to the real terminal; the addon keeps the
 * returned disposable and owns teardown. Register this before the custom path
 * provider so schemed http(s) URLs keep priority.
 */
export function registerWebLinksProvider(
	term: Terminal,
	activate: (event: MouseEvent, uri: string) => void,
): IDisposable {
	const facade = Object.create(term) as Terminal;
	facade.registerLinkProvider = (provider: ILinkProvider): IDisposable =>
		term.registerLinkProvider(decorateLinkProvider(provider));

	const addon = new WebLinksAddon(activate);
	addon.activate(facade);
	return addon;
}
