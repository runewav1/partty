/**
 * Central stack for layered chrome surfaces (modals, panels, menus).
 *
 * Every overlay pushes itself when it opens and releases when it closes.
 * A single capture-phase Escape listener closes the topmost open surface,
 * so dismissal behaves consistently everywhere without per-component
 * keydown wiring (previously several surfaces ignored Escape entirely).
 */

export type OverlayHandle = {
  /** Remove this overlay from the stack. Safe to call more than once. */
  release(): void;
};

type OverlayEntry = {
  close: () => void;
};

const stack: OverlayEntry[] = [];
let listenerInstalled = false;

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  // Win over legacy per-component Escape handlers so a single keypress
  // never closes two stacked surfaces at once.
  e.stopImmediatePropagation();
  top.close();
}

/**
 * Register an open overlay. `close` is invoked when Escape is pressed while
 * this overlay is topmost; it must cause the component to close (which in
 * turn should release the returned handle).
 */
export function pushOverlay(close: () => void): OverlayHandle {
  if (!listenerInstalled) {
    listenerInstalled = true;
    window.addEventListener("keydown", onGlobalKeydown, true);
  }
  const entry: OverlayEntry = { close };
  stack.push(entry);
  return {
    release() {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
    },
  };
}

/** Whether any overlay is currently open. */
export function anyOverlayOpen(): boolean {
  return stack.length > 0;
}
