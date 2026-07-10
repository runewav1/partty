import { invoke } from "@tauri-apps/api/core";

type KeybindsSnapshot = { bind: Record<string, string> };

interface ParsedBinding {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
  param: boolean;
}

const MOD_RE = /^(Ctrl|Alt|Shift|Meta)\+/i;

function parseBinding(raw: string): ParsedBinding | null {
  let s = raw.trim();
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  for (let i = 0; i < 4; i++) {
    const m = s.match(MOD_RE);
    if (!m) break;
    const mod = m[1].toLowerCase();
    if (mod === "ctrl") ctrl = true;
    else if (mod === "alt") alt = true;
    else if (mod === "shift") shift = true;
    else if (mod === "meta") meta = true;
    s = s.slice(m[0].length);
  }
  const key = s;
  if (!key) return null;
  return { ctrl, alt, shift, meta, key, param: key === "{n}" };
}

function normalizeKey(key: string): string {
  if (key.length === 1 && key >= "0" && key <= "9") return key;
  const l = key.toLowerCase();
  if (l === "arrowup") return "arrowup";
  if (l === "arrowdown") return "arrowdown";
  if (l === "arrowleft") return "arrowleft";
  if (l === "arrowright") return "arrowright";
  if (l === "enter") return "enter";
  if (l === "escape") return "escape";
  if (l === "tab") return "tab";
  if (l === "backspace") return "backspace";
  if (l === "delete") return "delete";
  if (l === "f2") return "f2";
  if (l === "/" || l === "slash") return "/";
  if (l === "," || l === "comma") return ",";
  if (l === "\\" || l === "backslash") return "\\";
  if (l === "." || l === "period") return ".";
  if (key.length === 1) return l;
  return l;
}

function keyMatches(ek: string, bk: string): boolean {
  return normalizeKey(ek) === normalizeKey(bk);
}

function digitIndex(e: KeyboardEvent): number {
  const c = e.code;
  if (c && c.startsWith("Digit")) {
    const n = parseInt(c.slice(5), 10);
    if (Number.isFinite(n)) return n;
  }
  if (c === "Numpad0") return 0;
  if (c === "Numpad1") return 1;
  if (c === "Numpad2") return 2;
  if (c === "Numpad3") return 3;
  if (c === "Numpad4") return 4;
  if (c === "Numpad5") return 5;
  if (c === "Numpad6") return 6;
  if (c === "Numpad7") return 7;
  if (c === "Numpad8") return 8;
  if (c === "Numpad9") return 9;
  return -1;
}

export interface KeybindMatch {
  action: string;
  param: number;
}

export interface KeybindsApi {
  ready: Promise<void>;
  match(e: KeyboardEvent, ...actions: string[]): string | null;
  matchParam(e: KeyboardEvent, ...actions: string[]): KeybindMatch | null;
  label(action: string): string;
  all(): Record<string, string>;
  set(action: string, binding: string): Promise<void>;
  reset(): Promise<void>;
}

const DEFAULT_BINDS: Record<string, string> = {
  "pane_split_down": "Alt+H",
  "pane_split_right": "Alt+V",
  "pane_close": "Ctrl+Shift+W",
  "pane_float_toggle": "Ctrl+Shift+O",
  "pane_focus_left": "Ctrl+ArrowLeft",
  "pane_focus_right": "Ctrl+ArrowRight",
  "pane_focus_up": "Ctrl+ArrowUp",
  "pane_focus_down": "Ctrl+ArrowDown",
  "pane_swap_left": "Ctrl+Shift+ArrowLeft",
  "pane_swap_right": "Ctrl+Shift+ArrowRight",
  "pane_swap_up": "Ctrl+Shift+ArrowUp",
  "pane_swap_down": "Ctrl+Shift+ArrowDown",
  "pane_move_to_tab": "Ctrl+Shift+{n}",
  "tab_switch": "Alt+{n}",
  "window_toggle": "Alt+Shift+T",
  "window_move_next_monitor": "Alt+Shift+ArrowRight",
  "window_move_prev_monitor": "Alt+Shift+ArrowLeft",
  "window_maximize": "Alt+Shift+ArrowUp",
  "window_restore": "Alt+Shift+ArrowDown",
  "settings_open": "Ctrl+,",
  "palette_open": "Ctrl+Shift+P",
  "palette_chord": "Ctrl+Shift+P",
  "help_toggle": "Ctrl+Shift+/",
  "focus_terminal": "Alt+ArrowRight",
  "focus_pane_up": "Alt+ArrowUp",
  "focus_pane_down": "Alt+ArrowDown",
  "terminal_newline": "Shift+Enter",
  "terminal_copy": "Ctrl+C",
  "terminal_paste": "Ctrl+V",
  "dev_toggle": "Ctrl+Shift+D",
};

export function createKeybinds(): KeybindsApi {
  const bind: Record<string, string> = { ...DEFAULT_BINDS };
  let parsed: Record<string, ParsedBinding | null> = {};
  let paramParsed: Record<string, ParsedBinding | null> = {};
  let readyResolve: () => void;
  const readyPromise = new Promise<void>((r) => { readyResolve = r; });

  function rebuild() {
    parsed = {};
    paramParsed = {};
    for (const [action, raw] of Object.entries(bind)) {
      const p = parseBinding(raw);
      parsed[action] = p;
      if (p && p.param) {
        paramParsed[action] = { ...p, param: false, key: "" };
      }
    }
  }

  rebuild();

  async function load() {
    try {
      const snap = await invoke<KeybindsSnapshot>("get_keybinds");
      for (const [action, raw] of Object.entries(snap.bind)) {
        bind[action] = raw;
      }
    } catch {
      /* keep defaults */
    }
    rebuild();
    readyResolve();
  }

  void load();

  return {
    ready: readyPromise,

    match(e: KeyboardEvent, ...actions: string[]): string | null {
      for (const action of actions) {
        const p = parsed[action];
        if (!p) continue;
        if (
          e.ctrlKey === p.ctrl &&
          e.altKey === p.alt &&
          e.shiftKey === p.shift &&
          e.metaKey === p.meta
        ) {
          if (p.param) {
            const n = digitIndex(e);
            if (n >= 0) return action;
          } else if (keyMatches(e.key, p.key)) {
            return action;
          }
        }
      }
      return null;
    },

    matchParam(e: KeyboardEvent, ...actions: string[]): KeybindMatch | null {
      for (const action of actions) {
        const p = parsed[action];
        if (!p) continue;
        if (
          e.ctrlKey === p.ctrl &&
          e.altKey === p.alt &&
          e.shiftKey === p.shift &&
          e.metaKey === p.meta
        ) {
          const n = digitIndex(e);
          if (n >= 0) {
            return { action, param: n };
          }
        }
      }
      return null;
    },

    label(action: string): string {
      return bind[action] ?? action;
    },

    all(): Record<string, string> {
      return { ...bind };
    },

    async set(action: string, binding: string): Promise<void> {
      await invoke("set_keybind", { action, binding });
      bind[action] = binding || "";
      rebuild();
    },

    async reset(): Promise<void> {
      await invoke("reset_keybinds");
      Object.assign(bind, DEFAULT_BINDS);
      for (const key of Object.keys(bind)) {
        if (!(key in DEFAULT_BINDS)) delete bind[key];
      }
      rebuild();
    },
  };
}
