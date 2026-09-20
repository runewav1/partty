/**
 * Cross-modal app-shortcut policy.
 *
 * The command island shows at most one surface at a time, and surfaces are
 * mutually exclusive: presenting one closes the others. Users still expect the
 * existing keybinds to *switch* between surfaces (palette, settings, help,
 * find) without first dismissing the current one, so a shortcut that summons a
 * surface must run even while another surface's search field owns focus.
 * Shortcuts that mutate pane/tab/window state stay suppressed inside an open
 * command surface so a chord cannot restructure the layout behind it.
 *
 * A blocking dialog (`.partty-dialog-*`) is not an island surface. Kept DOM-optional and
 * side-effect free so the rules are unit-testable without a browser.
 */

/** What a shortcut does when it fires. */
export type ShortcutEffect = "surface" | "mutation";

/** The slice of a keyboard event target this policy inspects. */
export type FocusTarget =
	| {
			closest?: (selector: string) => unknown;
	  }
	| null
	| undefined;

/** Island surfaces that own focus and may be switched between. */
const COMMAND_SURFACE_SELECTORS = [
	"#command-palette",
	"#settings-panel",
] as const;

/** Blocking dialogs excluded from settings/help surface switching. */
const BLOCKING_DIALOG_SELECTORS = [
	".partty-dialog-panel",
	".partty-dialog-input",
] as const;

function matchesAny(
	target: FocusTarget,
	selectors: readonly string[],
): boolean {
	if (!target?.closest) return false;
	for (const selector of selectors) {
		if (target.closest(selector)) return true;
	}
	return false;
}

/** True when the event target lives inside one of the switchable surfaces. */
export function isInCommandSurface(target: FocusTarget): boolean {
	return matchesAny(target, COMMAND_SURFACE_SELECTORS);
}

/** True when the event target lives inside a blocking dialog. */
export function isInBlockingDialog(target: FocusTarget): boolean {
	return matchesAny(target, BLOCKING_DIALOG_SELECTORS);
}

/**
 * Whether an app shortcut may run with `target` owning focus.
 *
 * `surface` shortcuts always run (outside a blocking dialog) so surfaces can be
 * switched between; `mutation` shortcuts are held back while a command surface
 * owns focus.
 */
export function shortcutRuns(
	effect: ShortcutEffect,
	target: FocusTarget,
): boolean {
	return effect === "surface"
		? !isInBlockingDialog(target)
		: !isInCommandSurface(target);
}
