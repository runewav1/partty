import { getCurrentWindow } from "@tauri-apps/api/window";

export type MouseCursorVisibilityPrefs = {
  /** Always hide the OS mouse cursor (overrides idle hide). */
  hidden: boolean;
  hideOnIdle: boolean;
  idleSeconds: number;
};

export type MouseCursorController = {
  sync(): void;
  notifyActivity(): void;
  setSuppress(suppressed: boolean): void;
  dispose(): void;
};

const HIDDEN_CLASS = "mouse-cursor-hidden";

let forceVisibleHandler: ((active: boolean) => void) | null = null;

/** Register handler (called once from app boot). */
export function bindMouseCursorForceVisible(handler: (active: boolean) => void): void {
  forceVisibleHandler = handler;
}

/** Force the OS cursor visible while modal / palette UI is open (refcounted). */
export function mouseCursorForceVisible(active: boolean): void {
  forceVisibleHandler?.(active);
}

function setDomHidden(hidden: boolean): void {
  document.documentElement.classList.toggle(HIDDEN_CLASS, hidden);
}

export function createMouseCursorController(
  getWindow: () => ReturnType<typeof getCurrentWindow>,
  getPrefs: () => MouseCursorVisibilityPrefs,
): MouseCursorController {
  let idleTimer = 0;
  let idleHidden = false;
  let suppressDepth = 0;

  function clearIdleTimer(): void {
    if (!idleTimer) return;
    window.clearTimeout(idleTimer);
    idleTimer = 0;
  }

  /** Best-effort OS API; broken on Windows WebView2 — CSS is the real hide path. */
  function setOsVisible(visible: boolean): void {
    void getWindow().setCursorVisible(visible).catch(() => {});
  }

  function showCursor(): void {
    setDomHidden(false);
    setOsVisible(true);
  }

  function applyHidden(hidden: boolean): void {
    if (suppressDepth > 0) {
      showCursor();
      return;
    }
    setDomHidden(hidden);
    setOsVisible(!hidden);
  }

  function scheduleIdleHide(): void {
    clearIdleTimer();
    const secs = getPrefs().idleSeconds;
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      const prefs = getPrefs();
      if (suppressDepth > 0 || prefs.hidden || !prefs.hideOnIdle) return;
      idleHidden = true;
      applyHidden(true);
    }, Math.max(0.5, secs) * 1000);
  }

  function sync(): void {
    clearIdleTimer();
    const prefs = getPrefs();

    if (suppressDepth > 0) {
      idleHidden = false;
      showCursor();
      return;
    }

    if (prefs.hidden) {
      idleHidden = false;
      applyHidden(true);
      return;
    }

    if (prefs.hideOnIdle && idleHidden) {
      applyHidden(true);
      return;
    }

    idleHidden = false;
    applyHidden(false);
    if (prefs.hideOnIdle) scheduleIdleHide();
  }

  function notifyActivity(): void {
    if (suppressDepth > 0) {
      showCursor();
      return;
    }

    const prefs = getPrefs();
    if (prefs.hidden) {
      applyHidden(true);
      return;
    }

    idleHidden = false;
    applyHidden(false);
    if (prefs.hideOnIdle) scheduleIdleHide();
  }

  function setSuppress(suppressed: boolean): void {
    if (suppressed) {
      suppressDepth += 1;
      idleHidden = false;
      clearIdleTimer();
      showCursor();
      return;
    }
    suppressDepth = Math.max(0, suppressDepth - 1);
    sync();
  }

  function dispose(): void {
    clearIdleTimer();
    idleHidden = false;
    suppressDepth = 0;
    showCursor();
  }

  return { sync, notifyActivity, setSuppress, dispose };
}
