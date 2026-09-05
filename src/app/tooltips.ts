/**
 * Tooltip policy: swap `title` attributes off/on across the DOM when tooltips
 * are disabled (user preference, or the tabs bar is hidden). Keeps original
 * titles stashed so they can be restored verbatim.
 */

const TOOLTIP_STASH_ATTR = "data-partty-tooltip-title";

export type TooltipController = {
	/** Apply the current suppression state to `root` (default document). */
	apply(root?: ParentNode): void;
	/** Install the title MutationObserver once. */
	ensureObserver(): void;
};

export function createTooltipController(
	isDisabled: () => boolean,
): TooltipController {
	let tooltipObserver: MutationObserver | null = null;

	const isTooltipSuppressed = (): boolean =>
		isDisabled() || document.documentElement.classList.contains("tabs-hidden");

	const syncTooltipForElement = (el: HTMLElement, suppress: boolean): void => {
		if (suppress) {
			if (el.hasAttribute("title")) {
				const title = el.getAttribute("title");
				if (title != null) {
					el.setAttribute(TOOLTIP_STASH_ATTR, title);
					el.removeAttribute("title");
				}
			}
			return;
		}

		if (!el.hasAttribute("title") && el.hasAttribute(TOOLTIP_STASH_ATTR)) {
			const original = el.getAttribute(TOOLTIP_STASH_ATTR) ?? "";
			el.setAttribute("title", original);
			el.removeAttribute(TOOLTIP_STASH_ATTR);
		}
	};

	const apply = (root: ParentNode = document): void => {
		const suppress = isTooltipSuppressed();
		document.documentElement.classList.toggle("tooltips-disabled", suppress);
		const all = (root as Document | Element).querySelectorAll<HTMLElement>(
			`[title], [${TOOLTIP_STASH_ATTR}]`,
		);
		all.forEach((el) => {
			syncTooltipForElement(el, suppress);
		});
		if (root instanceof HTMLElement) syncTooltipForElement(root, suppress);
	};

	const ensureObserver = (): void => {
		if (tooltipObserver) return;
		tooltipObserver = new MutationObserver((mutations) => {
			const suppress = isTooltipSuppressed();
			for (const m of mutations) {
				if (
					m.type === "attributes" &&
					m.target instanceof HTMLElement &&
					m.attributeName === "title"
				) {
					syncTooltipForElement(m.target, suppress);
					continue;
				}
				if (m.type !== "childList") continue;
				m.addedNodes.forEach((n) => {
					if (!(n instanceof HTMLElement)) return;
					syncTooltipForElement(n, suppress);
					n.querySelectorAll<HTMLElement>(
						"[title], [data-partty-tooltip-title]",
					).forEach((el) => {
						syncTooltipForElement(el, suppress);
					});
				});
			}
		});
		tooltipObserver.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["title"],
		});
	};

	return { apply, ensureObserver };
}
