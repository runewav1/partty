/**
 * Drag a floating panel by a handle; persists top/left in localStorage.
 * Positions are clamped to the viewport (on load and while dragging) so a
 * panel can never be stranded off-screen after a resolution change.
 */

const EDGE_MIN_VISIBLE = 48;

function clampLeft(left: number, panelWidth: number): number {
  const max = Math.max(0, window.innerWidth - Math.min(panelWidth, EDGE_MIN_VISIBLE * 2));
  return Math.max(Math.min(left, max), EDGE_MIN_VISIBLE - panelWidth);
}

function clampTop(top: number): number {
  return Math.max(0, Math.min(top, window.innerHeight - EDGE_MIN_VISIBLE));
}

export function attachDraggablePanel(panel: HTMLElement, handle: HTMLElement, posKey: string): void {
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;

  function loadPos(): void {
    try {
      const raw = localStorage.getItem(posKey);
      if (!raw) return;
      const j = JSON.parse(raw) as { left: number; top: number };
      if (typeof j.left === "number" && typeof j.top === "number") {
        panel.style.left = `${clampLeft(j.left, panel.offsetWidth || 320)}px`;
        panel.style.top = `${clampTop(j.top)}px`;
        panel.style.transform = "none";
      }
    } catch {
      /* ignore */
    }
  }

  function savePos(): void {
    const r = panel.getBoundingClientRect();
    localStorage.setItem(posKey, JSON.stringify({ left: r.left, top: r.top }));
  }

  loadPos();

  handle.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    drag = { x: e.clientX, y: e.clientY, ox: panel.offsetLeft, oy: panel.offsetTop };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    panel.style.left = `${clampLeft(drag.ox + dx, panel.offsetWidth)}px`;
    panel.style.top = `${clampTop(drag.oy + dy)}px`;
    panel.style.transform = "none";
  });
  handle.addEventListener("pointerup", (e) => {
    if (drag) savePos();
    drag = null;
    handle.releasePointerCapture(e.pointerId);
  });
}
