/**
 * Tab-bar chrome for the default renderer and for extensions.
 *
 * The strip (`#term-tabs-strip`) is still host-owned (switch / close / drag /
 * rename). Accessories live in stable leading / trailing / background slots
 * that survive strip rebuilds. Layout flags only tweak the wrap; they do not
 * invent a second tab model.
 */

export type TabBarJustify = "start" | "center" | "end";

export type TabBarSlot = "leading" | "trailing" | "background";

export type TabBarLayout = {
  tabJustify: TabBarJustify;
  /** When false (default), the strip hides if there is only one tab. */
  showSingleTab: boolean;
  /** Skip the built-in close hit target; the tab renderer owns close UI. */
  omitDefaultClose: boolean;
  /** When false, the wrap hugs its contents so leftover width is the drag region. */
  grow: boolean;
  /** CSS gap between leading / strip / trailing. */
  gap: string;
  /** CSS gap between items in a slot. */
  itemGap: string;
};

export const DEFAULT_TAB_BAR_LAYOUT: TabBarLayout = {
  tabJustify: "start",
  showSingleTab: false,
  omitDefaultClose: false,
  grow: true,
  gap: "0 8px",
  itemGap: "8px",
};

export type TabBarItem = {
  id: string;
  slot: TabBarSlot;
  order?: number;
  mount: (el: HTMLElement) => void | (() => void);
  update?: (el: HTMLElement) => void;
};

export type TabRenderModel = {
  id: string;
  /** 1-based index in strip order (same number used in live pane ids). */
  index: number;
  name: string;
  displayName: string;
  userName: string | null;
  color: string | null;
  groupId: string | null;
  groupName: string | null;
  groupColor: string | null;
  active: boolean;
  focusedPaneId: string | null;
};

export type TabGroupRenderModel = {
  id: string;
  name: string;
  color: string | null;
  collapsed: boolean;
  tabIds: string[];
};

export type TabRenderer = (tab: TabRenderModel, el: HTMLElement) => void;
export type TabGroupRenderer = (
  group: TabGroupRenderModel,
  el: HTMLElement,
) => void;

type MountedItem = {
  item: TabBarItem;
  el: HTMLElement;
  unmount: (() => void) | null;
};

export type TabBarEls = {
  wrap: HTMLElement;
  strip: HTMLElement;
  leading: HTMLElement;
  trailing: HTMLElement;
  background: HTMLElement;
};

export type TabBarController = {
  layout: () => TabBarLayout;
  setLayout: (partial: Partial<TabBarLayout>) => () => void;
  tabRenderer: () => TabRenderer | null;
  groupRenderer: () => TabGroupRenderer | null;
  registerTabRenderer: (fn: TabRenderer) => () => void;
  registerGroupRenderer: (fn: TabGroupRenderer) => () => void;
  registerItem: (item: TabBarItem) => () => void;
  afterStripRender: () => void;
  refreshItems: () => void;
  onChange: (fn: () => void) => () => void;
  notifyChanged: () => void;
};

const JUSTIFY: Record<TabBarJustify, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
};

export function initTabBar(els: TabBarEls): TabBarController {
  let layout: TabBarLayout = { ...DEFAULT_TAB_BAR_LAYOUT };
  let tabRenderer: TabRenderer | null = null;
  let groupRenderer: TabGroupRenderer | null = null;
  const items = new Map<string, TabBarItem>();
  const mounted = new Map<string, MountedItem>();
  const changeSubs: Array<() => void> = [];

  const slotEl = (slot: TabBarSlot): HTMLElement => {
    if (slot === "leading") return els.leading;
    if (slot === "trailing") return els.trailing;
    return els.background;
  };

  function applyLayout(): void {
    els.wrap.style.setProperty("--tabbar-justify", JUSTIFY[layout.tabJustify]);
    els.wrap.style.setProperty("--tabbar-gap", layout.gap);
    els.wrap.style.setProperty("--tabbar-item-gap", layout.itemGap);
    els.wrap.style.flex = layout.grow ? "1 1 auto" : "0 1 auto";
    els.wrap.style.gridTemplateColumns = layout.grow
      ? "auto minmax(0, 1fr) auto"
      : "auto auto auto";
    document.documentElement.classList.toggle(
      "term-tabs-force-strip",
      layout.showSingleTab,
    );
    els.wrap.classList.toggle(
      "term-tabbar--custom",
      tabRenderer != null || groupRenderer != null,
    );
  }

  function remountItems(): void {
    for (const m of mounted.values()) {
      try {
        m.unmount?.();
      } catch {
        /* ignore */
      }
    }
    mounted.clear();
    els.leading.replaceChildren();
    els.trailing.replaceChildren();
    els.background.replaceChildren();

    const ordered = [...items.values()].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
    );
    for (const item of ordered) {
      const el = document.createElement("div");
      el.className = "term-tabbar-item";
      el.dataset.tabbarItem = item.id;
      slotEl(item.slot).appendChild(el);
      let unmount: (() => void) | null = null;
      try {
        const u = item.mount(el);
        if (typeof u === "function") unmount = u;
      } catch {
        /* ignore */
      }
      mounted.set(item.id, { item, el, unmount });
    }
  }

  applyLayout();

  return {
    layout: () => layout,
    setLayout(partial) {
      const prev = layout;
      layout = { ...layout, ...partial };
      applyLayout();
      return () => {
        layout = prev;
        applyLayout();
      };
    },
    tabRenderer: () => tabRenderer,
    groupRenderer: () => groupRenderer,
    registerTabRenderer(fn) {
      tabRenderer = fn;
      applyLayout();
      return () => {
        if (tabRenderer === fn) tabRenderer = null;
        applyLayout();
      };
    },
    registerGroupRenderer(fn) {
      groupRenderer = fn;
      applyLayout();
      return () => {
        if (groupRenderer === fn) groupRenderer = null;
        applyLayout();
      };
    },
    registerItem(item) {
      const prev = items.get(item.id);
      if (prev) {
        const m = mounted.get(item.id);
        try {
          m?.unmount?.();
        } catch {
          /* ignore */
        }
      }
      items.set(item.id, item);
      remountItems();
      return () => {
        if (items.get(item.id) !== item) return;
        items.delete(item.id);
        remountItems();
      };
    },
    afterStripRender: refreshItems,
    refreshItems,
    onChange(fn) {
      changeSubs.push(fn);
      return () => {
        const i = changeSubs.indexOf(fn);
        if (i !== -1) changeSubs.splice(i, 1);
      };
    },
    notifyChanged() {
      for (const fn of changeSubs) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    },
  };

  function refreshItems(): void {
    for (const m of mounted.values()) {
      try {
        m.item.update?.(m.el);
      } catch {
        /* ignore */
      }
    }
  }
}
