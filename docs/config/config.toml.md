# `config.toml`

**Path:** `~/.partty/config.toml`

## `[shell]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `command` | string | `"pwsh"` | Shell executable name (e.g. `powershell`, `bash`, `cmd`) |
| `initial_dir` | string or absent | absent | Starting directory. Omit for system default |

## `[cursor]`

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `style` | string | `"block"` | `"block"` `"underline"` `"bar"` |
| `blink` | bool | `true` | |
| `width` | float px | `1.0` | `0.5`–`10.0` |
| `inactive_style` | string | `"outline"` | `"outline"` `"block"` `"bar"` `"underline"` `"none"` |
| `alt_click_moves` | bool | `true` | Alt+click repositions cursor |

## `[font]`

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `size` | float px | `12.0` | `8`–`48` |
| `weight` | string | `"normal"` | CSS `font-weight` |
| `weight_bold` | string | `"bold"` | CSS `font-weight` |
| `line_height` | float | `1.0` | `0.5`–`4.0` (multiplier) |
| `letter_spacing` | float px | `0.0` | `-2`–`10` |

## `[scroll]`

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `backlog` | u32 | `1000` | scrollback lines |
| `snapshot_max` | u32 | `2500` | lines kept for hide/restore |
| `smooth_duration_ms` | float | `0.0` | `0` (instant) – `1000` |
| `sensitivity` | float | `1.0` | `0.1`–`10.0` (multiplier) |
| `fast_sensitivity` | float | `5.0` | `1.0`–`50.0` (Alt+wheel) |

## `[display]`

| Key | Type | Default |
|-----|------|---------|
| `bright_bold` | bool | `true` |
| `custom_glyphs` | bool | `true` |
| `backspace_deletes_selection` | bool | `true` |

## `[pane]`

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `blur` | bool | `false` | unfocused pane blur |
| `blur_radius` | float px | `1.6` | `0`–`10` |
| `opacity_focused` | float | `1.0` | `0`–`1` — focused pane opacity |
| `opacity_unfocused` | float | `1.0` | `0`–`1` — unfocused pane opacity |
| `variable_opacity` | bool | `false` | enable per-pane opacity control |
| `focus_scale` | bool | `true` | slight scale emphasis |
| `focus_scale_intensity` | float | `0.45` | `0`–`1` |
| `corner_radius` | float px | `6.0` | `0`–`32` |
| `gap` | float px | `6.0` | pane gutter |
| `padding` | float px | `0.0` | pane sandbox padding |
| `square` | bool | `false` | disable rounded corners |
| `no_border` | bool | `false` | hide all pane borders |
| `no_focus_border` | bool | `false` | hide focus accent border |

## `[animation]`

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `speed` | string | `"normal"` | `"off"` `"fast"` `"normal"` `"slow"` |
| `easing` | string | `"smooth"` | `"smooth"` `"snappy"` `"gentle"` `"bouncy"` |
| `window_motion` | bool | `true` | settle animation on resize/move |

## `[split]`

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `layout` | string | `"balanced"` | `"balanced"` `"dwindle"` `"master"` |
| `quiet_defer` | bool | `false` | Ctrl+Shift+N moves pane without switching tab |

## `[window]`

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `always_on_top` | bool | `false` | |
| `summon_maximized` | bool | `false` | |
| `summon_at_cursor` | bool | `false` | place window at OS cursor on show |
| `hidden_from_taskbar` | bool | `false` | |
| `effect` | string | `"transparent"` | `"off"` `"transparent"` |
| `effect_opacity` | float | `0.0` | `0`–`1` |

## `[lifecycle]`

| Key | Type | Default |
|-----|------|---------|
| `shed_on_hide` | bool | `false` |
| `webgl_shed_on_hide` | bool | `true` |
| `discard_buffer` | bool | `false` |
| `prewarm_pty` | bool | `true` |
| `prewarm_webgl` | bool | `true` |
| `defer_show` | bool | `true` |
| `destroy_webview` | bool | `true` |

## `[focus]`

| Key | Type | Default |
|-----|------|---------|
| `follows_mouse` | bool | `false` |
| `warp_to_pane` | bool | `true` |
| `warp_with_window` | bool | `false` |

## `[workspace]`

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `shed_on_exit` | string | `"keep"` | `"keep"` `"shed"` `"ask"` |
| `auto_copy` | bool | `false` | copy terminal selection on change |

## `[notifications]`

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `command_threshold_secs` | float | `5.0` | min command duration for toast |
| `toast_duration_ms` | float | `5000.0` | `1000`–`30000` |
| `show_milliseconds` | bool | `false` | |
| `translucent` | bool | `false` | |

## `[mouse]`

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `always_hidden` | bool | `false` | |
| `hide_on_idle` | bool | `false` | |
| `idle_timeout_secs` | float | `3.0` | `0.5`–`300` |

## `[ui]`

| Key | Type | Default |
|-----|------|---------|
| `hide_tooltips` | bool | `false` |
| `zen_on_start` | bool | `false` |

## `[theme]`

| Key | Type | Default |
|-----|------|---------|
| `active` | string | `"system"` |
| `variant` | string | `"default"` |

## `[font_terminal]`

| Key | Type | Default |
|-----|------|---------|
| `family` | string | `""` (system stack) |

## `[font_ui]`

| Key | Type | Default |
|-----|------|---------|
| `family` | string | `""` (system stack) |

## `[dev.perf]`

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `enable` | bool | `false` | |
| `console` | bool | `false` | |
| `console_interval_ms` | u32 | `5000` | `1000`–`60000` |

---

## Minimal Example

```toml
[shell]
command = "pwsh"

[font]
size = 13.0

[pane]
blur = true
corner_radius = 0.0
square = true

[theme]
active = "tokyonight"
variant = "moon"
```
