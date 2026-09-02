/** Show scrollbar thumb briefly while scrolling (paired with `.partty-scroll-fade` in CSS). */
export function initParttyScrollFade(): void {
  let timer = 0;
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList.contains("partty-scroll-fade")) return;
      el.classList.add("partty-scroll-fade--active");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.classList.remove("partty-scroll-fade--active");
      }, 850);
    },
    true,
  );
}
