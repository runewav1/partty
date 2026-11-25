import { DEFAULT_TERMINAL_FONT_STACK } from "../terminal/uiTheme";
import { applyMotionPreferences } from "../util/motion";
import type { ParttyPrefs } from "./settingsPanel";

export function applyTerminalDisplayPrefs(
	raw: Partial<ParttyPrefs>,
	acrylicAvailable: boolean,
): void {
	const root = document.documentElement;
	const paneGap =
		typeof raw.terminal_pane_gap === "number"
			? raw.terminal_pane_gap
			: raw.terminal_no_gap
				? 0
				: 6;
	const sandboxPadding =
		typeof raw.terminal_sandbox_padding === "number"
			? raw.terminal_sandbox_padding
			: 0;
	root.classList.toggle("terminal-no-gap", paneGap <= 0);
	root.classList.toggle("terminal-no-round", Boolean(raw.terminal_no_round));
	root.classList.toggle(
		"terminal-no-pane-border",
		Boolean(raw.terminal_no_pane_border),
	);
	root.classList.toggle(
		"terminal-no-focus-border",
		Boolean(raw.terminal_no_focus_border),
	);
	applyMotionPreferences(
		raw.terminal_animation_speed,
		raw.terminal_animation_style,
	);
	const backdropAlpha =
		typeof raw.window_effect_opacity === "number"
			? raw.window_effect_opacity
			: 0;
	const appAlpha =
		raw.window_effect_mode === "transparent" ||
		(raw.window_effect_mode === "acrylic" && !acrylicAvailable)
			? backdropAlpha
			: raw.window_effect_mode === "acrylic"
				? 0
				: 1;
	const paneRadius =
		typeof raw.pane_corner_radius === "number" ? raw.pane_corner_radius : 6;
	root.style.setProperty(
		"--pane-outer-gap",
		`${Math.max(0, Math.min(32, paneGap))}px`,
	);
	root.style.setProperty(
		"--pane-sandbox-padding",
		`${Math.max(0, Math.min(32, sandboxPadding))}px`,
	);
	root.style.setProperty("--partty-app-bg-alpha", String(appAlpha));
	root.style.setProperty(
		"--partty-pane-radius",
		`${Math.max(0, Math.min(32, paneRadius))}px`,
	);
}

export function applyPaneFocusPresentation(raw: Partial<ParttyPrefs>): void {
	const { classList, style } = document.documentElement;
	classList.toggle("pane-blur-unfocused", Boolean(raw.blur_unfocused_panes));
	style.setProperty("--pane-blur-radius", String(raw.pane_blur_radius ?? 1.6));
	style.setProperty(
		"--pane-opacity-focused",
		String(raw.pane_opacity_focused ?? 1),
	);
	style.setProperty(
		"--pane-opacity-unfocused",
		String(raw.pane_opacity_unfocused ?? 1),
	);
	classList.toggle("pane-variable-opacity", Boolean(raw.pane_variable_opacity));

	const intensity = Math.max(
		0,
		Math.min(
			1,
			typeof raw.pane_focus_scale_intensity === "number"
				? raw.pane_focus_scale_intensity
				: 0.45,
		),
	);
	classList.toggle(
		"pane-focus-scale",
		(raw.focus_pane_scale ?? true) && intensity > 0,
	);
	style.setProperty("--pane-focus-scale-delta", String(intensity * 0.014));
}

export function terminalFontStackFromDocument(): string {
	const raw = getComputedStyle(document.documentElement)
		.getPropertyValue("--font-terminal")
		.trim();
	return raw.replace(/^["']|["']$/g, "") || DEFAULT_TERMINAL_FONT_STACK;
}
