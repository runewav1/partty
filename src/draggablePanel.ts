/**
 * Drag a floating panel by a handle; persists top/left in localStorage.
 */
export function attachDraggablePanel(panel: HTMLElement, handle: HTMLElement, posKey: string): void {
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;

  function loadPos(): void {
    try {
      const raw = localStorage.getItem(posKey);
      if (!raw) return;
      const j = JSON.parse(raw) as { left: number; top: number };
      if (typeof j.left === "number" && typeof j.top === "number") {
        panel.style.left = `${j.left}px`;
        panel.style.top = `${j.top}px`;
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
    panel.style.left = `${drag.ox + dx}px`;
    panel.style.top = `${drag.oy + dy}px`;
    panel.style.transform = "none";
  });
  handle.addEventListener("pointerup", (e) => {
    if (drag) savePos();
    drag = null;
    handle.releasePointerCapture(e.pointerId);
  });
}
