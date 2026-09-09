/**
 * Ctrl+wheel terminal font-size zoom geometry.
 *
 * Bounds mirror the historic inline font zoom limits (6..32 px) while letting
 * the per-notch step be configured via Settings. Pure module (no imports, no
 * DOM) so the math is directly unit-testable in Node.
 */

export const ZOOM_FONT_MIN = 6;
export const ZOOM_FONT_MAX = 32;

export const ZOOM_STEP_DEFAULT = 0.25;
export const ZOOM_STEP_MIN = 0.05;
export const ZOOM_STEP_MAX = 2;

/** Font sizes are quantized onto this grid to shed binary-float drift. */
const FONT_SIZE_QUANTUM = 1_000;

/**
 * Normalize a configured zoom step (CSS px) into its valid finite range,
 * falling back to the default when the value is missing or non-finite.
 */
export function normalizeZoomStep(value: number): number {
	if (!Number.isFinite(value)) return ZOOM_STEP_DEFAULT;
	return Math.max(ZOOM_STEP_MIN, Math.min(ZOOM_STEP_MAX, value));
}

/**
 * Fold a signed px delta into the next zoomed font size. Fractional deltas are
 * preserved (never truncated to integers) and the result is clamped to the
 * zoom bounds.
 */
export function nextZoomFontSize(current: number, deltaPx: number): number {
	const base = Number.isFinite(current) ? current : 12;
	const next =
		Math.round((base + deltaPx) * FONT_SIZE_QUANTUM) / FONT_SIZE_QUANTUM;
	return Math.max(ZOOM_FONT_MIN, Math.min(ZOOM_FONT_MAX, next));
}
