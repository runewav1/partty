/**
 * Small animation helpers shared by chrome surfaces and pane/tab motion.
 *
 * All app motion is CSS-class driven; these helpers centralize the
 * reduced-motion checks and the run-class-until-animationend pattern that
 * was previously duplicated inline.
 */

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

/** True when animations should be skipped (OS setting or app motion=off). */
export function motionDisabled(): boolean {
  return (
    reducedMotionQuery.matches ||
    document.documentElement.classList.contains("terminal-motion-off")
  );
}

/** Cancel in-flight CSS animations/transitions on an element (and optionally descendants). */
export function cancelElementAnimations(
  el: HTMLElement,
  subtree = false,
): void {
  try {
    for (const anim of el.getAnimations({ subtree })) {
      anim.cancel();
    }
  } catch {
    /* older WebView2 */
  }
}

/**
 * Add `className` to `el`, resolve when its animation ends, then remove the
 * class. Resolves immediately when motion is disabled. A safety timeout
 * guarantees resolution even if `animationend` never fires (display:none
 * mid-flight, zero-duration animations, dropped frames).
 *
 * Cancels prior animations on `el` first so rapid retargeting (tab spam,
 * create/destroy) never stacks competing transforms.
 */
export function animateClass(
  el: HTMLElement,
  className: string,
  safetyTimeoutMs = 600,
): Promise<void> {
  cancelElementAnimations(el);
  el.classList.remove(className);
  if (motionDisabled()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      el.classList.remove(className);
      el.removeEventListener("animationend", onEnd);
      window.clearTimeout(timer);
      resolve();
    };
    const onEnd = (e: AnimationEvent): void => {
      if (e.target === el) finish();
    };
    const timer = window.setTimeout(finish, safetyTimeoutMs);
    el.addEventListener("animationend", onEnd);
    // Force a style flush so the browser restarts the animation cleanly
    // when the same class is re-applied in quick succession.
    void el.offsetWidth;
    el.classList.add(className);
  });
}
