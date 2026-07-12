import type { PaneNode, PaneSplit } from "./paneHost";
import { findPaneLeaf } from "./paneHost";
import { mouseCursorForceVisible } from "./mouseCursor";
import { writePresetJson, type Preset } from "./presets";
import { THEME_OPTIONS, normalizePaneThemePrefs, themeCssVarsForPrefs } from "./uiTheme";

export type PresetEditorApi = {
  open(preset: Preset): void;
  close(): void;
  isOpen(): boolean;
};

function collectLeafIds(tree: PaneNode): string[] {
  const ids: string[] = [];
  (function walk(n: PaneNode): void {
    if (n.kind === "leaf") { ids.push(n.id); return; }
    walk(n.a); walk(n.b);
  })(tree);
  return ids;
}

function accentForPane(id: string, preset: Preset): string {
  const t = preset.paneThemes[id];
  const vars = t ? themeCssVarsForPrefs(t) : {};
  return vars["--accent-primary"] || "var(--accent-primary)";
}

export function createPresetEditorModal(root: HTMLElement): PresetEditorApi {
  let open = false;
  let preset: Preset | null = null;
  let selectedId = "";

  root.className = "theme-builder-root theme-builder-root--hidden";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = "";

  const backdrop = document.createElement("div");
  backdrop.className = "theme-builder-backdrop";

  const panel = document.createElement("div");
  panel.className = "theme-builder-panel";
  panel.style.width = "min(720px, 96vw)";
  panel.style.maxHeight = "min(88vh, 680px)";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Preset editor");

  // ── Header ──
  const head = mk("div", "theme-builder-head", panel);
  const title = mk("h2", "theme-builder-title", head);
  title.textContent = "Preset editor";
  const closeBtn = mkBtn("theme-builder-close", "\u00d7", head);
  closeBtn.setAttribute("aria-label", "Close");

  // ── Name ──
  const nameRow = mk("div", "theme-builder-name-row", panel);
  nameRow.style.padding = "10px 14px 6px";
  const nameLabel = mk("label", "theme-builder-label", nameRow);
  nameLabel.textContent = "Tab name";
  const nameInput = mk("input", "theme-builder-input", nameRow) as HTMLInputElement;

  // ── Body: tree + props ──
  const body = mk("div", "", panel);
  body.style.display = "flex";
  body.style.flex = "1";
  body.style.minHeight = "0";
  body.style.gap = "0";
  body.style.borderTop = "1px solid var(--panel-divider)";
  body.style.borderBottom = "1px solid var(--panel-divider)";

  // Tree column
  const treeCol = mk("div", "", body);
  treeCol.style.flex = "1";
  treeCol.style.minWidth = "0";
  treeCol.style.display = "flex";
  treeCol.style.flexDirection = "column";
  treeCol.style.padding = "10px";
  treeCol.style.gap = "6px";

  const treeHd = mk("div", "", treeCol);
  treeHd.style.display = "flex";
  treeHd.style.justifyContent = "space-between";
  treeHd.style.alignItems = "center";
  const treeLabel = mk("span", "", treeHd);
  treeLabel.style.fontSize = "11px";
  treeLabel.style.fontWeight = "600";
  treeLabel.style.color = "var(--ui-chrome-muted)";
  treeLabel.style.letterSpacing = "0.03em";
  treeLabel.style.textTransform = "uppercase";
  treeLabel.textContent = "Layout";

  const treeActions = mk("div", "", treeHd);
  treeActions.style.display = "flex";
  treeActions.style.gap = "5px";

  const treePreview = mk("div", "preset-tree-preview", treeCol) as HTMLElement;
  treePreview.style.flex = "1";
  treePreview.style.display = "flex";
  treePreview.style.border = "1px solid var(--panel-border)";
  treePreview.style.borderRadius = "var(--termie-pane-radius, 8px)";
  treePreview.style.background = "color-mix(in srgb, var(--term-bg) 30%, transparent)";
  treePreview.style.overflow = "hidden";
  treePreview.style.minHeight = "200px";

  // Properties column
  const propCol = mk("div", "", body);
  propCol.style.flex = "0 0 280px";
  propCol.style.display = "flex";
  propCol.style.flexDirection = "column";
  propCol.style.borderLeft = "1px solid var(--panel-divider)";
  propCol.style.padding = "10px 14px";
  propCol.style.gap = "10px";
  propCol.style.overflowY = "auto";

  const propHd = mk("span", "", propCol);
  propHd.style.fontSize = "11px";
  propHd.style.fontWeight = "600";
  propHd.style.color = "var(--ui-chrome-muted)";
  propHd.style.letterSpacing = "0.03em";
  propHd.style.textTransform = "uppercase";
  propHd.textContent = "Selected pane";

  const propId = mk("div", "", propCol);
  propId.style.fontSize = "10px";
  propId.style.color = "var(--ui-chrome-fainter)";
  propId.style.overflow = "hidden";
  propId.style.textOverflow = "ellipsis";
  propId.style.whiteSpace = "nowrap";
  propId.style.fontFamily = "var(--font-terminal)";

  const paneNameIpt = mkRow("Name", propCol) as HTMLInputElement;
  const cwdIpt = mkRow("Directory", propCol) as HTMLInputElement;
  const startupIpt = mkRow("Startup cmd", propCol) as HTMLInputElement;

  // Theme selector
  const themeWrap = mk("div", "", propCol);
  themeWrap.style.display = "flex";
  themeWrap.style.flexDirection = "column";
  themeWrap.style.gap = "4px";
  const themeLabel = mk("span", "", themeWrap);
  themeLabel.style.fontSize = "11px";
  themeLabel.style.color = "var(--ui-chrome-muted)";
  themeLabel.style.fontWeight = "500";
  themeLabel.textContent = "Theme";
  const themeSel = mk("select", "theme-builder-input", themeWrap) as HTMLSelectElement;
  themeSel.style.fontSize = "12px";
  const noThemeOpt = document.createElement("option");
  noThemeOpt.value = "";
  noThemeOpt.textContent = "App theme";
  themeSel.appendChild(noThemeOpt);
  for (const t of THEME_OPTIONS) {
    for (const v of t.variants) {
      const opt = document.createElement("option");
      opt.value = `${t.id}\0${v.id}`;
      opt.textContent = `${t.label} \u2014 ${v.label}`;
      themeSel.appendChild(opt);
    }
  }

  // Action buttons under props
  const actSection = mk("div", "", propCol);
  actSection.style.display = "flex";
  actSection.style.flexWrap = "wrap";
  actSection.style.gap = "5px";
  actSection.style.marginTop = "auto";
  actSection.style.paddingTop = "8px";
  actSection.style.borderTop = "1px solid var(--panel-divider)";

  const splitVBtn = mkSmBtn("Split side", actSection);
  const splitHBtn = mkSmBtn("Split below", actSection);
  const removeBtn2 = mkSmBtn("Remove", actSection);

  // ── Footer ──
  const foot = mk("div", "theme-builder-foot", panel);
  const saveBtn = mk("button", "theme-builder-save", foot) as HTMLButtonElement;
  saveBtn.textContent = "Save preset";
  const cancelBtn = mk("button", "theme-builder-cancel", foot) as HTMLButtonElement;
  cancelBtn.textContent = "Cancel";

  root.appendChild(backdrop);
  root.appendChild(panel);

  // ── Helpers ──
  function mk(tag: string, className: string, parent: HTMLElement): HTMLElement {
    const el = document.createElement(tag);
    if (className) el.className = className;
    parent.appendChild(el);
    return el;
  }
  function mkBtn(className: string, text: string, parent: HTMLElement): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = text;
    parent.appendChild(b);
    return b;
  }
  function mkSmBtn(text: string, parent: HTMLElement): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "theme-builder-cancel";
    b.style.padding = "5px 10px";
    b.style.fontSize = "11px";
    b.textContent = text;
    parent.appendChild(b);
    return b;
  }
  function mkRow(label: string, parent: HTMLElement): HTMLInputElement {
    const wrap = mk("div", "", parent);
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "3px";
    const lbl = mk("span", "", wrap);
    lbl.style.fontSize = "11px";
    lbl.style.color = "var(--ui-chrome-muted)";
    lbl.style.fontWeight = "500";
    lbl.textContent = label;
    const inp = mk("input", "theme-builder-input", wrap) as HTMLInputElement;
    inp.style.fontSize = "12px";
    return inp;
  }

  // ── Tree rendering ──
  function renderTreeNode(node: PaneNode, container: HTMLElement): void {
    if (node.kind === "leaf") {
      const box = mk("div", "preset-editor-leaf", container);
      box.dataset.paneId = node.id;
      box.style.flex = "1";
      box.style.minWidth = "0";
      box.style.minHeight = "0";
      box.style.display = "flex";
      box.style.flexDirection = "column";
      box.style.alignItems = "center";
      box.style.justifyContent = "center";
      box.style.gap = "2px";
      box.style.margin = "3px";
      box.style.borderRadius = "6px";
      box.style.border = node.id === selectedId
        ? "2px solid var(--accent-primary)"
        : "1px solid color-mix(in srgb, var(--panel-border) 60%, transparent)";
      box.style.background = accentForPane(node.id, preset!) + "14";
      box.style.cursor = "pointer";
      box.style.transition = "border-color var(--motion-fast) var(--motion-ease-out), background var(--motion-fast) var(--motion-ease-out)";
      box.title = node.id;
      box.addEventListener("click", (e) => { e.stopPropagation(); selectPane(node.id); });
      box.addEventListener("mouseenter", () => {
        if (node.id !== selectedId) box.style.borderColor = "var(--accent-primary-light)";
      });
      box.addEventListener("mouseleave", () => {
        if (node.id !== selectedId) box.style.borderColor = "color-mix(in srgb, var(--panel-border) 60%, transparent)";
      });

      const nameSpan = mk("span", "", box);
      nameSpan.style.fontSize = "11px";
      nameSpan.style.fontWeight = "600";
      nameSpan.style.color = "var(--ui-chrome-fg)";
      nameSpan.style.overflow = "hidden";
      nameSpan.style.textOverflow = "ellipsis";
      nameSpan.style.whiteSpace = "nowrap";
      nameSpan.style.maxWidth = "90%";
      nameSpan.textContent = preset?.paneNames[node.id] || "pane";

      const cwdSpan = mk("span", "", box);
      cwdSpan.style.fontSize = "9px";
      cwdSpan.style.color = "var(--ui-chrome-fainter)";
      cwdSpan.style.overflow = "hidden";
      cwdSpan.style.textOverflow = "ellipsis";
      cwdSpan.style.whiteSpace = "nowrap";
      cwdSpan.style.maxWidth = "90%";
      const cwdHint = preset?.paneCwds[node.id];
      cwdSpan.textContent = cwdHint ? cwdHint.replace(/\\/g, "/").split("/").pop() || cwdHint : "";

      const accent = mk("div", "", box);
      accent.style.width = "24px";
      accent.style.height = "3px";
      accent.style.borderRadius = "2px";
      accent.style.marginTop = "2px";
      accent.style.background = accentForPane(node.id, preset!);

      return;
    }
    const wrapper = mk("div", "", container);
    wrapper.style.display = "flex";
    wrapper.style.flex = "1";
    wrapper.style.flexDirection = node.dir === "h" ? "row" : "column";
    wrapper.style.minWidth = "0";
    wrapper.style.minHeight = "0";
    wrapper.style.gap = "0";

    const a = mk("div", "", wrapper);
    a.style.flex = String(node.ratio);
    a.style.display = "flex";
    a.style.minWidth = "0";
    a.style.minHeight = "0";
    renderTreeNode(node.a, a);
    const g = mk("div", "", wrapper);
    g.style.flex = "0 0 4px";
    g.style.background = "var(--panel-divider)";
    g.style.margin = "4px 0";
    const b = mk("div", "", wrapper);
    b.style.flex = String(1 - node.ratio);
    b.style.display = "flex";
    b.style.minWidth = "0";
    b.style.minHeight = "0";
    renderTreeNode(node.b, b);
  }

  function refreshTree(): void {
    if (!preset) return;
    treePreview.replaceChildren();
    renderTreeNode(preset.tree, treePreview);
  }

  function selectPane(id: string): void {
    if (!preset || !findPaneLeaf(preset.tree, id)) return;
    applyCurrentToSelected();
    selectedId = id;
    refreshTree();
    propId.textContent = id;
    paneNameIpt.value = preset.paneNames[id] ?? "";
    cwdIpt.value = preset.paneCwds[id] ?? "";
    startupIpt.value = preset.startupCommands?.[id] ?? "";
    const theme = preset.paneThemes[id];
    const normalized = theme ? normalizePaneThemePrefs(theme) : null;
    themeSel.value = normalized
      ? `${normalized.ui_theme}\0${normalized.ui_theme_variant}`
      : "";
  }

  function applyCurrentToSelected(): void {
    if (!preset || !selectedId || !findPaneLeaf(preset.tree, selectedId)) return;
    const name = paneNameIpt.value.trim();
    const cwd = cwdIpt.value.trim();
    const startup = startupIpt.value.trim();
    const tv = themeSel.value;
    if (name) preset.paneNames[selectedId] = name; else delete preset.paneNames[selectedId];
    if (cwd) preset.paneCwds[selectedId] = cwd; else delete preset.paneCwds[selectedId];
    if (!preset.startupCommands) preset.startupCommands = {};
    if (startup) preset.startupCommands[selectedId] = startup; else delete preset.startupCommands[selectedId];
    if (tv) {
      const [ui_theme, ui_theme_variant] = tv.split("\0") as [string, string];
      preset.paneThemes[selectedId] = normalizePaneThemePrefs({ ui_theme, ui_theme_variant });
    } else {
      delete preset.paneThemes[selectedId];
    }
  }

  [paneNameIpt, cwdIpt, startupIpt].forEach((el) => el.addEventListener("change", applyCurrentToSelected));
  themeSel.addEventListener("change", applyCurrentToSelected);

  splitVBtn.addEventListener("click", () => {
    if (!preset || !selectedId || !findPaneLeaf(preset.tree, selectedId)) return;
    applyCurrentToSelected();
    const nid = crypto.randomUUID();
    const rep: PaneSplit = { kind: "split", dir: "h", ratio: 0.5, a: { kind: "leaf", id: selectedId }, b: { kind: "leaf", id: nid } };
    preset.tree = replaceLeaf(preset.tree, selectedId, rep) ?? preset.tree;
    selectPane(nid);
  });
  splitHBtn.addEventListener("click", () => {
    if (!preset || !selectedId || !findPaneLeaf(preset.tree, selectedId)) return;
    applyCurrentToSelected();
    const nid = crypto.randomUUID();
    const rep: PaneSplit = { kind: "split", dir: "v", ratio: 0.5, a: { kind: "leaf", id: selectedId }, b: { kind: "leaf", id: nid } };
    preset.tree = replaceLeaf(preset.tree, selectedId, rep) ?? preset.tree;
    selectPane(nid);
  });
  removeBtn2.addEventListener("click", () => {
    if (!preset || !selectedId) return;
    if (collectLeafIds(preset.tree).length <= 1) return;
    applyCurrentToSelected();
    preset.tree = removeLeaf(preset.tree, selectedId) ?? preset.tree;
    const rest = collectLeafIds(preset.tree);
    selectedId = rest[0] ?? "";
    selectPane(selectedId);
  });

  saveBtn.addEventListener("click", async () => {
    if (!preset) return;
    applyCurrentToSelected();
    preset.tabName = nameInput.value.trim() || preset.name;
    try { await writePresetJson(preset.name, JSON.stringify(preset)); close(); }
    catch (e) { console.error("save preset", e); }
  });
  cancelBtn.addEventListener("click", () => close());
  backdrop.addEventListener("click", () => close());
  closeBtn.addEventListener("click", () => close());
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  function close(): void {
    if (!open) return;
    open = false;
    mouseCursorForceVisible(false);
    preset = null;
    selectedId = "";
    root.classList.add("theme-builder-root--hidden");
    root.setAttribute("aria-hidden", "true");
  }

  return {
    open: (p) => {
      preset = JSON.parse(JSON.stringify(p)) as Preset;
      if (!preset.startupCommands) preset.startupCommands = {};
      nameInput.value = preset.tabName || preset.name;
      const ids = collectLeafIds(preset.tree);
      selectedId = ids[0] ?? "";
      open = true;
      mouseCursorForceVisible(true);
      root.classList.remove("theme-builder-root--hidden");
      root.setAttribute("aria-hidden", "false");
      refreshTree();
      selectPane(selectedId);
    },
    close,
    isOpen: () => open,
  };
}

function replaceLeaf(tree: PaneNode, leafId: string, rep: PaneNode): PaneNode | null {
  if (tree.kind === "leaf") return tree.id === leafId ? rep : null;
  const na = replaceLeaf(tree.a, leafId, rep);
  if (na) return { ...tree, a: na };
  const nb = replaceLeaf(tree.b, leafId, rep);
  if (nb) return { ...tree, b: nb };
  return null;
}

function removeLeaf(tree: PaneNode, leafId: string): PaneNode | null {
  if (tree.kind === "leaf") return tree.id === leafId ? null : tree;
  const a = removeLeaf(tree.a, leafId);
  const b = removeLeaf(tree.b, leafId);
  if (a == null) return b;
  if (b == null) return a;
  return { ...tree, a, b };
}
