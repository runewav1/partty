/** Show scrollbar thumb briefly while scrolling (paired with `.termie-scroll-fade` in CSS). */
export function initTermieScrollFade(): void {
  let timer = 0;
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList.contains("termie-scroll-fade")) return;
      el.classList.add("termie-scroll-fade--active");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.classList.remove("termie-scroll-fade--active");
      }, 850);
    },
    true,
  );
}
