import type { ConnectionProfile } from "./connectionProfiles";
import { getProfileById } from "./connectionProfiles";
import { mouseCursorForceVisible } from "./mouseCursor";
import {
  THEME_OPTIONS,
  normalizePaneThemePrefs,
  themeCssVarsForPrefs,
  type PaneThemePrefs,
} from "./uiTheme";
import {
  listLeafIds,
  removeLeafFromTree,
  splitLeafInTree,
} from "./workspaceTreeOps";
import {
  cwdBasename,
  normalizePaneCwdForProfile,
  profileSupportsStartupCwd,
} from "./workspacePanePath";
import { WorkspaceEditorViewport } from "./workspaceEditorViewport";
import { normalizeLayoutForWorkspace } from "./workspaceLayout";
import { writeWorkspace, type Workspace, type WorkspaceLayout } from "./workspaces";

export type WorkspaceLoadTarget = "current" | "new";

export type WorkspaceEditorApi = {
  open(workspace: Workspace): void;
  openCapture(workspace: Workspace): void;
  close(): void;
  isOpen(): boolean;
};

export type WorkspaceEditorOptions = {
  root: HTMLElement;
  getProfiles: () => ConnectionProfile[];
  onApply: (workspace: Workspace, target: WorkspaceLoadTarget) => Promise<void>;
};

type DraftMaps = {
  paneNames: Record<string, string>;
  paneCwds: Record<string, string>;
  paneProfileIds: Record<string, string>;
  paneThemes: Record<string, PaneThemePrefs>;
  startupCommands: Record<string, string>;
};

function emptyDraftMaps(): DraftMaps {
  return {
    paneNames: {},
    paneCwds: {},
    paneProfileIds: {},
    paneThemes: {},
    startupCommands: {},
  };
}

function mapsFromLayout(layout: WorkspaceLayout): DraftMaps {
  return {
    paneNames: { ...(layout.paneNames ?? {}) },
    paneCwds: { ...(layout.paneCwds ?? {}) },
    paneProfileIds: { ...(layout.paneProfileIds ?? {}) },
    paneThemes: Object.fromEntries(
      Object.entries(layout.paneThemes ?? {}).map(([id, t]) => [
        id,
        normalizePaneThemePrefs(t),
      ]),
    ),
    startupCommands: { ...(layout.startupCommands ?? {}) },
  };
}

export function createWorkspaceEditorModal(
  opts: WorkspaceEditorOptions,
): WorkspaceEditorApi {
  const { root, getProfiles, onApply } = opts;
  let open = false;
  let maps = emptyDraftMaps();
  let selectedId = "";
  let viewport: WorkspaceEditorViewport | null = null;

  root.className = "workspace-editor-root workspace-editor-root--hidden";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = "";

  const backdrop = document.createElement("div");
  backdrop.className = "workspace-editor-backdrop";

  const panel = document.createElement("div");
  panel.className = "workspace-editor-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Workspace editor");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "theme-builder-close workspace-editor-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "\u00d7";

  const metaRow = document.createElement("div");
  metaRow.className = "workspace-editor-meta";

  const nameInput = document.createElement("input");
  nameInput.className = "theme-builder-input workspace-editor-name-input";
  nameInput.type = "text";
  nameInput.placeholder = "Workspace name";
  nameInput.setAttribute("aria-label", "Workspace name");
  nameInput.spellcheck = false;

  metaRow.append(nameInput);

  const body = document.createElement("div");
  body.className = "workspace-editor-body";

  const viewportMount = document.createElement("div");
  viewportMount.className = "workspace-editor-viewport-mount";

  const props = document.createElement("div");
  props.className = "workspace-editor-props";

  const propsTitle = document.createElement("div");
  propsTitle.className = "workspace-editor-props-title";
  propsTitle.textContent = "Pane";

  const paneIdLabel = document.createElement("div");
  paneIdLabel.className = "workspace-editor-pane-id";

  const paneNameInput = document.createElement("input");
  paneNameInput.className = "theme-builder-input";
  paneNameInput.placeholder = "Pane name";

  const profileSel = document.createElement("select");
  profileSel.className = "theme-builder-input";

  const cwdInput = document.createElement("input");
  cwdInput.className = "theme-builder-input";
  cwdInput.placeholder = "Starting directory";

  const startupInput = document.createElement("input");
  startupInput.className = "theme-builder-input";
  startupInput.placeholder = "e.g. npm run dev";
  startupInput.spellcheck = false;

  const themeSel = document.createElement("select");
  themeSel.className = "theme-builder-input";
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

  const propActions = document.createElement("div");
  propActions.className = "workspace-editor-prop-actions";
  const splitSideBtn = mkActionBtn("Split side");
  const splitBelowBtn = mkActionBtn("Split below");
  const removeBtn = mkActionBtn("Remove");
  propActions.append(splitSideBtn, splitBelowBtn, removeBtn);

  props.append(
    propsTitle,
    paneIdLabel,
    mkField("Name", paneNameInput),
    mkField("Profile", profileSel),
    mkField("Directory", cwdInput),
    mkField("Startup command", startupInput),
    mkField("Theme", themeSel),
    propActions,
  );

  body.append(viewportMount, props);

  const foot = document.createElement("div");
  foot.className = "workspace-editor-foot";
  const saveBtn = mkFootBtn("Save", "theme-builder-save");
  const applyCurrentBtn = mkFootBtn("Apply to tab", "theme-builder-cancel");
  const applyNewBtn = mkFootBtn("Open in new tab", "theme-builder-cancel");
  const cancelBtn = mkFootBtn("Cancel", "theme-builder-cancel");
  foot.append(saveBtn, applyCurrentBtn, applyNewBtn, cancelBtn);

  panel.append(closeBtn, metaRow, body, foot);
  root.append(backdrop, panel);

  function mkField(label: string, control: HTMLElement): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "workspace-editor-field";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    wrap.append(lbl, control);
    return wrap;
  }

  function mkActionBtn(text: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "theme-builder-cancel workspace-editor-action-btn";
    b.textContent = text;
    return b;
  }

  function mkFootBtn(text: string, cls: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    return b;
  }

  function profileForPane(id: string): ConnectionProfile | null {
    const pid = maps.paneProfileIds[id];
    if (!pid) return getProfiles()[0] ?? null;
    return getProfileById(pid, getProfiles());
  }

  function accentForPane(id: string): string {
    const theme = maps.paneThemes[id];
    const vars = theme ? themeCssVarsForPrefs(theme) : {};
    return vars["--accent-primary"] || "var(--accent-primary)";
  }

  function rebuildProfileOptions(): void {
    const profiles = getProfiles();
    const cur = profileSel.value;
    profileSel.replaceChildren();
    for (const p of profiles) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      profileSel.appendChild(opt);
    }
    if (cur && profiles.some((p) => p.id === cur)) profileSel.value = cur;
    else if (profiles[0]) profileSel.value = profiles[0].id;
  }

  function syncCwdFieldState(): void {
    const profile = profileForPane(selectedId);
    const supported = profileSupportsStartupCwd(profile);
    cwdInput.disabled = !supported;
    cwdInput.placeholder = supported
      ? "Starting directory"
      : "Not supported for SSH";
  }

  function applyPropsToMaps(): void {
    if (!selectedId || !viewport) return;
    const name = paneNameInput.value.trim();
    if (name) maps.paneNames[selectedId] = name;
    else delete maps.paneNames[selectedId];

    const profile = getProfileById(profileSel.value, getProfiles());
    if (profile) maps.paneProfileIds[selectedId] = profile.id;
    else delete maps.paneProfileIds[selectedId];

    const cwdRaw = cwdInput.value.trim();
    if (profileSupportsStartupCwd(profile) && cwdRaw) {
      maps.paneCwds[selectedId] = normalizePaneCwdForProfile(cwdRaw, profile);
    } else {
      delete maps.paneCwds[selectedId];
    }

    const startup = startupInput.value.trim();
    if (startup) maps.startupCommands[selectedId] = startup;
    else delete maps.startupCommands[selectedId];

    const tv = themeSel.value;
    if (tv) {
      const [ui_theme, ui_theme_variant] = tv.split("\0") as [string, string];
      maps.paneThemes[selectedId] = normalizePaneThemePrefs({
        ui_theme,
        ui_theme_variant,
      });
    } else {
      delete maps.paneThemes[selectedId];
    }
    viewport.refresh();
  }

  function fillPropsForPane(id: string): void {
    paneIdLabel.textContent = id;
    paneNameInput.value = maps.paneNames[id] ?? "";
    cwdInput.value = maps.paneCwds[id] ?? "";
    startupInput.value = maps.startupCommands[id] ?? "";
    const profile = profileForPane(id);
    profileSel.value = profile?.id ?? profileSel.value;
    syncCwdFieldState();
    const theme = maps.paneThemes[id];
    const normalized = theme ? normalizePaneThemePrefs(theme) : null;
    themeSel.value = normalized
      ? `${normalized.ui_theme}\0${normalized.ui_theme_variant}`
      : "";
  }

  function selectPane(id: string): void {
    if (!viewport) return;
    applyPropsToMaps();
    selectedId = id;
    viewport.selectPane(id);
  }

  function buildWorkspace(): Workspace | null {
    if (!viewport) return null;
    applyPropsToMaps();
    const trimmed = nameInput.value.trim();
    if (!trimmed) return null;
    const pl = {
      v: 1 as const,
      tree: viewport.getTree(),
      focusedId: viewport.getFocusedId(),
      paneNames: maps.paneNames,
      paneCwds: maps.paneCwds,
      paneProfileIds: maps.paneProfileIds,
      paneThemes: maps.paneThemes,
    };
    const layout = normalizeLayoutForWorkspace({
      layout: pl,
      paneThemes: new Map(Object.entries(maps.paneThemes)),
      paneNames: new Map(Object.entries(maps.paneNames)),
      paneCwdHints: new Map(Object.entries(maps.paneCwds)),
      paneProfileIds: new Map(Object.entries(maps.paneProfileIds)),
      startupCommands: new Map(Object.entries(maps.startupCommands)),
    });
    return {
      version: 1,
      name: trimmed,
      layout,
    };
  }

  function ensureViewport(layout: WorkspaceLayout): void {
    viewport = new WorkspaceEditorViewport(viewportMount, {
      getPaneView: (id) => {
        const profile = profileForPane(id);
        const cwd = maps.paneCwds[id] ?? "";
        return {
          id,
          name: maps.paneNames[id] || "pane",
          profileLabel: profile?.name ?? "Default",
          cwdHint: cwd ? cwdBasename(cwd) : "",
          accentColor: accentForPane(id),
        };
      },
      onSelect: (id) => {
        selectedId = id;
        fillPropsForPane(id);
      },
      onTreeChange: () => {},
    });
    viewport.setTree(layout.tree, layout.focusedId);
    const ids = listLeafIds(layout.tree);
    selectedId = ids.includes(layout.focusedId) ? layout.focusedId : (ids[0] ?? "");
    selectPane(selectedId);
  }

  function syncNameActions(): void {
    const hasName = nameInput.value.trim().length > 0;
    saveBtn.disabled = !hasName;
    applyCurrentBtn.disabled = !hasName;
    applyNewBtn.disabled = !hasName;
  }

  function openWithWorkspace(w: Workspace, opts?: { capture?: boolean }): void {
    maps = mapsFromLayout(w.layout);
    nameInput.value = opts?.capture ? "" : w.name;
    rebuildProfileOptions();
    ensureViewport(w.layout);
    syncNameActions();
    open = true;
    mouseCursorForceVisible(true);
    root.classList.remove("workspace-editor-root--hidden");
    root.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("workspace-editor-open");
    if (opts?.capture) nameInput.focus();
  }

  splitSideBtn.addEventListener("click", () => {
    if (!viewport || !selectedId) return;
    applyPropsToMaps();
    const tree = viewport.getTree();
    const res = splitLeafInTree(tree, selectedId, "h");
    if (!res) return;
    viewport.setTree(res.tree, res.newLeafId);
    selectPane(res.newLeafId);
  });

  splitBelowBtn.addEventListener("click", () => {
    if (!viewport || !selectedId) return;
    applyPropsToMaps();
    const tree = viewport.getTree();
    const res = splitLeafInTree(tree, selectedId, "v");
    if (!res) return;
    viewport.setTree(res.tree, res.newLeafId);
    selectPane(res.newLeafId);
  });

  removeBtn.addEventListener("click", () => {
    if (!viewport || !selectedId) return;
    applyPropsToMaps();
    const tree = viewport.getTree();
    const ids = listLeafIds(tree);
    if (ids.length <= 1) return;
    const next = removeLeafFromTree(tree, selectedId);
    if (!next) return;
    const rest = listLeafIds(next);
    viewport.setTree(next, rest[0] ?? "");
    selectPane(rest[0] ?? "");
  });

  profileSel.addEventListener("change", () => {
    syncCwdFieldState();
    applyPropsToMaps();
  });
  [paneNameInput, cwdInput, startupInput, themeSel].forEach((el) => {
    el.addEventListener("change", () => applyPropsToMaps());
  });
  nameInput.addEventListener("input", () => syncNameActions());

  saveBtn.disabled = true;
  applyCurrentBtn.disabled = true;
  applyNewBtn.disabled = true;

  saveBtn.addEventListener("click", async () => {
    const w = buildWorkspace();
    if (!w) return;
    try {
      await writeWorkspace(w);
      close();
    } catch (e) {
      console.error("save workspace", e);
    }
  });

  applyCurrentBtn.addEventListener("click", async () => {
    const w = buildWorkspace();
    if (!w) return;
    close();
    await onApply(w, "current");
  });

  applyNewBtn.addEventListener("click", async () => {
    const w = buildWorkspace();
    if (!w) return;
    close();
    await onApply(w, "new");
  });

  cancelBtn.addEventListener("click", () => close());
  backdrop.addEventListener("click", () => close());
  closeBtn.addEventListener("click", () => close());
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  function close(): void {
    if (!open) return;
    open = false;
    viewport = null;
    viewportMount.replaceChildren();
    mouseCursorForceVisible(false);
    root.classList.add("workspace-editor-root--hidden");
    root.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("workspace-editor-open");
  }

  return {
    open: (w) => openWithWorkspace(w),
    openCapture: (w) => {
      openWithWorkspace(w, { capture: true });
    },
    close,
    isOpen: () => open,
  };
}
