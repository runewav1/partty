/** One shell per island host. Layout is measured only when content changes;
 * transforms carry the visible geometry between those measurements. */
export type IslandMotionPhase = "open" | "close" | "morph";
export type IslandMotionOptions = (phase: IslandMotionPhase) => {
	duration: number;
	easing: string;
};
type Size = { width: number; height: number };
type IslandRenderState = {
	el: HTMLElement;
	host: HTMLElement;
	panel: HTMLElement;
	shell: HTMLElement;
	body: HTMLElement;
	neck: HTMLElement;
	observer?: ResizeObserver;
	pending?: HTMLElement;
	size: Size;
	phase: IslandMotionPhase;
	options: IslandMotionOptions;
	animations: Animation[];
	done?: () => void;
	finish?: () => void;
};

const surfaces = new WeakMap<HTMLElement, IslandRenderState>();
const hosts = new WeakMap<HTMLElement, IslandRenderState>();
const moving = new Set<IslandRenderState>();

function visibleSize(state: IslandRenderState): Size {
	const rect = state.body.getBoundingClientRect();
	return {
		width: rect.width,
		height: Math.max(0, rect.bottom - state.host.getBoundingClientRect().top),
	};
}

function cancel(state: IslandRenderState): void {
	state.finish = undefined;
	for (const animation of state.animations) animation.cancel();
	state.animations = [];
	moving.delete(state);
}

/** Release the shell only if this view still owns it (switches transfer it). */
export function disposeIslandMotion(el: HTMLElement): void {
	const state = surfaces.get(el);
	if (!state) return;
	cancel(state);
	state.observer?.disconnect();
	state.shell.remove();
	el.classList.remove("island-rendered");
	surfaces.delete(el);
	hosts.delete(state.host);
}

export function finishIslandMotion(): void {
	for (const state of [...moving]) state.finish?.();
}

/** Re-sample rather than restarting from zero when speed/feel changes live. */
export function refreshIslandMotionPreferences(): void {
	for (const state of [...moving]) transition(state, visibleSize(state));
}

/** Keep the current shape while a lazy view loads, instead of close/reopen. */
export function prepareIslandView(host: HTMLElement, next: HTMLElement): void {
	const state = hosts.get(host);
	if (!state) return;
	if (state.el === next) {
		state.pending = undefined;
		return;
	}
	const from = visibleSize(state);
	cancel(state);
	state.pending = next;
	state.shell.style.width = `${from.width}px`;
	state.body.style.height = `${from.height}px`;
	state.body.style.transform = "none";
	state.neck.style.transform = `translateY(${Math.min(from.height, 18) - 18}px)`;
}

function observe(state: IslandRenderState): void {
	state.observer = new ResizeObserver(() => {
		if (surfaces.get(state.el) !== state || state.pending) return;
		const width = state.panel.offsetWidth;
		const height = state.panel.offsetHeight;
		if (!width || !height) return;
		if (width === state.size.width && height === state.size.height) return;
		const from = visibleSize(state);
		state.size = { width, height };
		if (state.phase !== "close" && !state.animations.length) {
			state.phase = "morph";
		}
		transition(state, from);
	});
	state.observer.observe(state.panel);
}

function transition(
	state: IslandRenderState,
	from: Size,
	newContent = false,
): void {
	const { duration, easing } = state.options(state.phase);
	const { width, height } = state.size;
	const closing = state.phase === "close";
	const targetHeight = closing ? 0 : height;
	// The shell uses a tall backing surface translated above the viewport.
	// This keeps the lower corner radius intact during height morphs.
	const backingHeight = Math.max(from.height, height, 1);
	const opacity = newContent ? 0 : getComputedStyle(state.panel).opacity || "1";
	cancel(state);
	state.shell.style.width = `${width}px`;
	state.shell.style.height = `${height}px`;
	state.body.style.height = `${backingHeight}px`;
	const bodyTarget = `translateY(${targetHeight - backingHeight}px) scaleX(1)`;
	const neckTarget = `translateY(${Math.min(targetHeight, 18) - 18}px) scaleX(1)`;
	state.body.style.transform = bodyTarget;
	state.neck.style.transform = neckTarget;
	const finish = () => {
		if (state.finish !== finish) return;
		const done = state.done;
		state.done = undefined;
		// Hide first, then release the exit fill; ownership can change in done().
		done?.();
		if (state.finish !== finish) return;
		cancel(state);
		if (closing) disposeIslandMotion(state.el);
	};
	state.finish = finish;
	if (duration === 0) {
		finish();
		return;
	}
	const ratio = width ? from.width / width : 1;
	const insetX = Math.max(0, (width - from.width) / 2);
	const insetBottom = Math.max(0, height - from.height);
	const options: KeyframeAnimationOptions = { duration, easing, fill: "both" };
	state.animations = [
		state.body.animate(
			[
				{
					transform: `translateY(${from.height - backingHeight}px) scaleX(${ratio})`,
				},
				{ transform: bodyTarget },
			],
			options,
		),
		state.neck.animate(
			[
				{
					transform: `translateY(${Math.min(from.height, 18) - 18}px) scaleX(${ratio})`,
				},
				{ transform: neckTarget },
			],
			options,
		),
		state.panel.animate(
			[
				{
					clipPath: `inset(0px ${insetX}px ${insetBottom}px round 0px 0px 18px 18px)`,
					opacity,
				},
				{
					clipPath: `inset(0px 0px ${closing ? height : 0}px round 0px 0px 18px 18px)`,
					opacity: 1,
				},
			],
			options,
		),
	];
	const start = document.timeline.currentTime;
	for (const animation of state.animations) animation.startTime = start;
	state.animations[0].onfinish = finish;
	moving.add(state);
}

export function animateIslandSurface(
	el: HTMLElement,
	opening: boolean,
	options: IslandMotionOptions,
	done?: () => void,
): boolean {
	if (!el.classList.contains("command-island-view")) return false;
	const panel = el.querySelector<HTMLElement>(".command-island-panel");
	if (!panel) return false;
	const host = el.parentElement ?? el;
	let state = surfaces.get(el);
	let from: Size;
	let newContent = false;
	if (!state && !opening) {
		// An outgoing view may have already handed the shell to its successor.
		const waiting = hosts.get(host);
		if (waiting?.pending === el) disposeIslandMotion(waiting.el);
		done?.();
		return true;
	}
	if (state?.pending && !opening) {
		state.done = undefined;
		done?.();
		return true;
	}
	if (!state) {
		state = hosts.get(host);
		if (state) {
			from = visibleSize(state);
			const previous = state.el;
			const previousDone = state.done;
			cancel(state);
			state.observer?.disconnect();
			surfaces.delete(previous);
			previous.classList.remove("island-rendered");
			// The owning module has already released its overlay/focus handlers.
			previousDone?.();
			state.el = el;
			state.panel = panel;
			state.done = undefined;
			state.pending = undefined;
			newContent = true;
		} else {
			const shell = document.createElement("div");
			const body = document.createElement("div");
			const neck = document.createElement("div");
			shell.className = "island-shell";
			body.className = "island-shell-body";
			neck.className = "island-shell-neck";
			shell.setAttribute("aria-hidden", "true");
			shell.append(body, neck);
			host.append(shell);
			state = {
				el,
				host,
				panel,
				shell,
				body,
				neck,
				options,
				size: { width: panel.offsetWidth, height: panel.offsetHeight },
				phase: "open",
				animations: [],
			};
			from = { width: panel.offsetWidth, height: 0 };
		}
		surfaces.set(el, state);
		hosts.set(host, state);
		el.classList.add("island-rendered");
		observe(state);
	} else {
		from = visibleSize(state);
	}
	state.options = options;
	state.size = { width: panel.offsetWidth, height: panel.offsetHeight };
	state.phase = opening ? (newContent ? "morph" : "open") : "close";
	state.done = done;
	transition(state, from, newContent);
	return true;
}
