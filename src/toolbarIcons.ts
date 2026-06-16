import { createElement, X } from "lucide";

/** Small Lucide X for tab close buttons on the tab strip. */
export function createTabCloseIcon(): SVGElement {
  return createElement(X, {
    width: 14,
    height: 14,
    class: "term-tab-close-svg",
    "stroke-width": 2,
    "aria-hidden": "true",
  }) as SVGElement;
}
