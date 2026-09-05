/**
 * Small animation helpers shared by chrome surfaces and pane/tab motion.
 *
 * All app motion is CSS-class driven; these helpers centralize the
 * reduced-motion checks and the run-class-until-animationend pattern that
 * was previously duplicated inline.
 */

const reducedMotionQuery = window.matchMedia(
	"(prefers-reduced-motion: reduce)",
);
const activeClassAnimations = new WeakMap<HTMLElement, () => void>();
let durationScale = 1;

function animationScaleForPreference(value: unknown): number {
	const raw = typeof value === "string" ? value.toLowerCase() : "normal";
	if (raw === "off") return 0;
	if (raw === "fast") return 0.55;
	if (raw === "slow") return 1.65;
	return 1;
}

function motionStyleForPreference(value: unknown): string {
	const raw = typeof value === "string" ? value.toLowerCase() : "smooth";
	if (raw === "snappy" || raw === "gentle" || raw === "bouncy") return raw;
	return "smooth";
}

function motionFeelScale(style: string): number {
	if (style === "snappy") return 0.72;
	if (style === "gentle") return 1.28;
	if (style === "bouncy") return 1.08;
	return 1;
}

/** Apply persisted motion preferences to the shared CSS motion tokens. */
export function applyMotionPreferences(speed: unknown, style: unknown): void {
	const root = document.documentElement;
	const scale = animationScaleForPreference(speed);
	const normalizedStyle = motionStyleForPreference(style);
	durationScale = scale * motionFeelScale(normalizedStyle);
	root.classList.toggle("terminal-motion-off", scale === 0);
	root.style.setProperty("--partty-animation-scale", String(scale));
	root.style.setProperty(
		"--motion-feel",
		String(motionFeelScale(normalizedStyle)),
	);
	root.dataset.motionStyle = normalizedStyle;
}

/** True when animations should be skipped (OS setting or app motion=off). */
export function motionDisabled(): boolean {
	return (
		reducedMotionQuery.matches ||
		document.documentElement.classList.contains("terminal-motion-off")
	);
}

/** Resolve a shared duration using the same speed + feel multipliers as CSS. */
export function motionDurationMs(duration: "fast" | "medium" | "slow"): number {
	if (motionDisabled()) return 0;
	const baseMs = duration === "fast" ? 130 : duration === "slow" ? 280 : 200;
	return baseMs * durationScale;
}

/** Cancel in-flight CSS animations/transitions on an element (and optionally descendants). */
export function cancelElementAnimations(
	el: HTMLElement,
	subtree = false,
): void {
	activeClassAnimations.get(el)?.();
	try {
		for (const anim of el.getAnimations({ subtree })) {
			anim.cancel();
		}
	} catch {
		/* older WebView2 */
	}
}

/**
 * Add `className` to `el`, remove it when its animation ends, and invoke the
 * optional completion callback. Completion is immediate when motion is
 * disabled. A safety timeout guarantees cleanup even if `animationend` never
 * fires (display:none mid-flight, zero-duration animations, dropped frames).
 *
 * Cancels prior animations on `el` first so rapid retargeting (tab spam,
 * create/destroy) never stacks competing transforms or stale cleanup timers.
 * The callback form avoids allocating a Promise for one-shot UI motion.
 */
function runClassAnimation(
	el: HTMLElement,
	className: string,
	safetyTimeoutMs: number,
	onFinish?: () => void,
): void {
	cancelElementAnimations(el);
	el.classList.remove(className);
	if (motionDisabled()) {
		onFinish?.();
		return;
	}

	let done = false;
	let timer = 0;
	const cancel = (): void => {
		if (done) return;
		done = true;
		el.classList.remove(className);
		el.removeEventListener("animationend", onEnd);
		window.clearTimeout(timer);
		if (activeClassAnimations.get(el) === cancel) {
			activeClassAnimations.delete(el);
		}
	};
	const finish = (): void => {
		if (done) return;
		cancel();
		onFinish?.();
	};
	const onEnd = (e: AnimationEvent): void => {
		if (e.target === el) finish();
	};
	activeClassAnimations.set(el, cancel);
	timer = window.setTimeout(finish, safetyTimeoutMs);
	el.addEventListener("animationend", onEnd);
	// Force a style flush so the browser restarts the animation cleanly
	// when the same class is re-applied in quick succession.
	void el.offsetWidth;
	el.classList.add(className);
}

export function animateClass(
	el: HTMLElement,
	className: string,
	onFinish?: () => void,
	safetyTimeoutMs = 700,
): void {
	runClassAnimation(el, className, safetyTimeoutMs, onFinish);
}

export function hideSurface(
	el: HTMLElement,
	hiddenClass: string,
	onHidden?: () => void,
): void {
	animateClass(el, "motion-surface--leaving", () => {
		el.classList.add(hiddenClass);
		onHidden?.();
	});
}

export function showSurface(el: HTMLElement, hiddenClass: string): void {
	cancelElementAnimations(el);
	el.classList.remove("motion-surface--leaving");
	el.classList.remove(hiddenClass);
}

/** Run a callback after a paint boundary without creating a Promise. */
export function afterAnimationFrames(callback: () => void, count = 2): void {
	if (count <= 0) {
		callback();
		return;
	}
	let remaining = count;
	const step = (): void => {
		remaining -= 1;
		if (remaining <= 0) callback();
		else requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}
