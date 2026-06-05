import { Cog, createElement, Folder, FolderOpen, Plus, X } from "lucide";

const iconOpts = {
  width: 20,
  height: 20,
  class: "term-toolbar-svg",
  "stroke-width": 1.75,
  "aria-hidden": "true" as const,
};

/** Lucide gear icon for settings. */
export function mountSettingsCogIcon(): void {
  const wrap = document.querySelector("#settings-toggle .term-toolbar-btn-icon");
  if (!wrap) return;
  const svg = createElement(Cog, {
    ...iconOpts,
    class: "term-toolbar-svg term-toolbar-cog",
  });
  wrap.replaceChildren(svg);
}

/** Lucide folder open/closed for file tree toggle (visibility toggled in `syncFileTreeFolderIcon`). */
export function mountFileTreeFolderIcons(): void {
  const wrap = document.querySelector("#file-tree-toggle .term-toolbar-btn-icon");
  if (!wrap) return;
  const closed = createElement(Folder, {
    ...iconOpts,
    class: "term-toolbar-svg term-toolbar-files-svg term-toolbar-files-svg--closed",
  });
  const open = createElement(FolderOpen, {
    ...iconOpts,
    class: "term-toolbar-svg term-toolbar-files-svg term-toolbar-files-svg--open",
  });
  wrap.replaceChildren(closed, open);
}

/** Lucide plus for new workspace tab (matches `.term-toolbar-svg` sizing in CSS). */
export function mountTabNewPlusIcon(): void {
  const wrap = document.querySelector("#term-tab-new .term-tab-new-icon");
  if (!wrap) return;
  const svg = createElement(Plus, {
    ...iconOpts,
    class: "term-toolbar-svg term-tab-new-svg",
  });
  wrap.replaceChildren(svg);
}

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

export function syncFileTreeFolderIcon(fileTreeOn: boolean): void {
  const wrap = document.querySelector("#file-tree-toggle .term-toolbar-btn-icon");
  if (!wrap) return;
  const closed = wrap.querySelector(".term-toolbar-files-svg--closed");
  const open = wrap.querySelector(".term-toolbar-files-svg--open");
  if (closed instanceof SVGElement && open instanceof SVGElement) {
    closed.style.display = fileTreeOn ? "none" : "";
    open.style.display = fileTreeOn ? "" : "none";
  }
}
