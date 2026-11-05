const HOLD_MS = 350;

/** Tap on release OR hold-to-choose, never both. Blur cancels pending work. */
export function createThemeFamilyShortcut(
	cycle: () => Promise<void>,
	showFamily: (isCurrent: () => boolean) => Promise<void>,
	onError: (error: unknown) => void,
	now: () => number = () => performance.now(),
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pressId = 0;
	let pressed = false;
	let held = false;
	let pressedKey = "";
	let startedAt = 0;
	const hold = () => {
		if (!pressed || held) return;
		held = true;
		const id = pressId;
		void showFamily(() => id === pressId).catch(onError);
	};
	const cancel = () => {
		pressed = false;
		pressId++;
		clearTimeout(timer);
	};
	return {
		press(key = "") {
			if (pressed) return;
			pressed = true;
			held = false;
			pressedKey = key;
			startedAt = now();
			pressId++;
			timer = setTimeout(hold, HOLD_MS);
		},
		release(key?: string) {
			if (!pressed || (key !== undefined && key !== pressedKey)) return;
			clearTimeout(timer);
			// Classify by elapsed time even if a busy UI delayed the timer.
			if (now() - startedAt >= HOLD_MS) hold();
			pressed = false;
			if (!held) void cycle().catch(onError);
		},
		cancel,
	};
}
