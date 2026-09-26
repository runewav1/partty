# `config.toml`

**Path:** `~/.partty/config.toml`

## `[profiles]`

Spawn defaults and picker behavior. **Profile definitions, SSH, WSL, and aliases:** [`profiles.md`](../profiles.md).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `default` | string | `"local-default"` | Profile id for new tabs (when `new_tab_uses_default`) |
| `shell` | string | `"pwsh"` | Fallback shell for local profiles with no `shell` |
| `initial_dir` | string or absent | absent | Default start directory |
| `inherit_on_split` | bool | `true` | Splits copy parent profile |
| `inherit_cwd_on_split` | bool | `true` | Splits copy parent cwd |
| `palette_tab_picker` | bool | `true` | Tab on New tab / Split → profile picker |
| `new_tab_uses_default` | bool | `true` | New tabs use `default` |
| `omit` | string[] | `[]` | Hide profile ids from pickers |
| `palette_icons` | bool | `true` | Icons in profile picker |

```toml
[profiles]
default = "local-pwsh"
shell = "pwsh"
omit = ["local-powershell", "wsl-docker-desktop"]
```

```toml
[profiles.selection_aliases]
a = "wsl-ubuntu"
s = "ssh-prod"
```

## `[cursor]`

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `style` | string | `"block"` | `"block"` `"underline"` `"bar"` |
| `blink` | bool | `true` | |
| `width` | float px | `1.0` | `0.5`–`10.0` |
| `inactive_style` | string | `"outline"` | `"outline"` `"block"` `"bar"` `"underline"` `"none"` |
| `alt_click_moves` | bool | `true` | Alt+click repositions cursor |
| `trail` | float ms | `0` | Cursor trail stationary delay; `0` disables (kitty `cursor_trail`) |
| `trail_decay` | float s, float s | `[0.1, 0.4]` | `[fast, slow]`; slow is raised to at least fast (kitty `cursor_trail_decay`) |
| `trail_start_threshold` | float or `[float, float]` cells | `2` | Cells of travel needed to start a trail; a single value applies to both axes (kitty `cursor_trail_start_threshold`) |
| `trail_color` | string | `"none"` | Any CSS color; `none` uses the theme cursor color (kitty `cursor_trail_color`) |

### Cursor trail

The cursor trail is a GPU-only effect implemented by the WebGL and WebGPU
renderers; the DOM renderer ignores it. It exposes four kitty controls, mapped
here to `trail`, `trail_decay`, `trail_start_threshold` and `trail_color`; the
motion, decay, threshold and color semantics follow kitty's `cursor_trail`,
`cursor_trail_decay`, `cursor_trail_start_threshold` and `cursor_trail_color`.
The exact geometry, easing and masking live in ParTTY's packaged xterm.js build;
see that project's cursor trail documentation for the precise behaviour. The
effect is off by default (`trail = 0`), and the OS reduced-motion preference
disables it automatically (there is no per-user override). `trail_start_threshold`
only decides whether a trail starts and the comparison is strictly greater than
the threshold.

```toml
[cursor]
trail = 250
trail_decay = [0.1, 0.4]
trail_start_threshold = [2, 2]
trail_color = "#80bfff"
```

## `[font]`

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `size` | float px | `12.0` | `8`–`48` |
| `zoom_step` | float px | `0.25` | `0.05`–`2` (per-notch wheel zoom step; used by both `terminal_zoom_*` hovered and all-visible keybinds, see [`keybinds.toml`](keybinds.toml.md)) |
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
| `backspace_deletes_selection` | bool | `true` | Backspace deletes a single-line selection on the cursor line (sends arrow keys + DEL to the shell; no-op for multi-line / scrollback) |

## `[terminal]`

Renderer selection for terminal panes. WebGPU is the default renderer; the
`useWebGL` key opts into the WebGL compatibility renderer instead.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `useWebGL` | bool | `false` | Use the WebGL compatibility renderer instead of WebGPU. Enable only when the WebGPU renderer fails or misrenders on your hardware. Takes effect after a restart. |

```toml
[terminal]
useWebGL = true
```

The old `[terminal.experimental] webgpu` knob was removed. WebGPU is now the
default, so legacy `webgpu = false` configs (the previous default, which meant
WebGL) are **not** migrated to WebGL — they get the new WebGPU default, and
legacy `webgpu = true` already used WebGPU. The key is ignored if still present
in old config files.

### `[terminal.experimental]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `sideload_openconsole` | bool | `false` | Use a sideloaded `conpty.dll` / `OpenConsole.exe` next to the binary as the ConPTY host (Windows Terminal's approach), enabling image protocols (sixel / kitty / iTerm) that the inbox host filters out. Takes effect for PTYs spawned after the first one; falls back to the inbox host when the DLLs are absent. |

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

### Split layout styles

| Value | Behavior |
|-------|----------|
| `balanced` | Manual splits; hotkey direction honored; 50/50 |
| `dwindle` | Direction from focused pane aspect ratio; 50/50 |
| `master` | Left master (~68%); further splits stack on the right |

Changing style does not rewrite existing trees.

## `[window]`

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `always_on_top` | bool | `false` | |
| `summon_maximized` | bool | `false` | |
| `summon_at_cursor` | bool | `false` | place window at OS cursor on show |
| `hidden_from_taskbar` | bool | `false` | |
| `startup_visible` | bool | `true` | show window immediately on launch; disable to require summon keybind |
| `effect` | string | `"transparent"` | `"off"` `"transparent"` `"acrylic"` |
| `effect_opacity` | float | `0.0` | `0`–`1` — backdrop opacity; used only by `"transparent"` |
| `effect_acrylic_tint` | string | `"#1e1e1e"` | `#rrggbb` tint color over the acrylic blur |
| `effect_acrylic_tint_alpha` | float | `0.55` | `0`–`1` — acrylic tint strength (higher = less backdrop shows through) |

`effect` selects the window backdrop: `"off"` is an opaque window, `"transparent"` makes
the webview background semi-transparent via `effect_opacity`, and `"acrylic"` applies a
native acrylic blur (`SetWindowCompositionAttribute`) tinted by `effect_acrylic_tint` /
`effect_acrylic_tint_alpha`. All three keys persist independently, so switching backdrops
keeps each one's previous value.

## `[lifecycle]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `shed_on_hide` | bool | `false` | Kill PTYs on hide |
| `webgl_shed_on_hide` | bool | `true` | Dispose WebGL on hide |
| `discard_buffer` | bool | `false` | Skip scrollback snapshot/restore on hide |
| `prewarm_pty` | bool | `true` | |
| `prewarm_webgl` | bool | `true` | |
| `defer_show` | bool | `true` | Hold window until layout is ready |
| `destroy_webview` | bool | `true` | Tear down WebView2 on hide; with `discard_buffer = false`, scrollback is restored on summon |

## `[focus]`

| Key | Type | Default |
|-----|------|---------|
| `follows_mouse` | bool | `false` |
| `warp_to_pane` | bool | `true` |
| `warp_with_window` | bool | `false` |

## `[session]`

Terminal session behavior (tabs/layouts in localStorage, copy/paste). Not the same as saved **workspaces** under `~/.partty/workspaces/` — see [workspaces.toml.md](workspaces.toml.md).

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `shed_on_exit` | string | `"keep"` | `"keep"` `"shed"` `"ask"` — discard tab session on quit |
| `auto_copy` | bool | `false` | copy terminal selection on change |
| `right_click_paste` | bool | `true` | right-click in a terminal pane pastes from the clipboard |
| `osc52` | bool | `true` | allow remote programs (e.g. over SSH) to read and write the local clipboard via OSC 52 — disable if you don't want remote processes touching your clipboard |
| `retain_session_state` | bool | `true` | keep pane layouts and working directories across restarts |

## `[workspaces]`

How a workspace behaves when it is opened from the command palette (`Open workspace…`).

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `open_mode` | string | `"new-tab"` | `"new-tab"` — open the workspace in a new tab · `"replace"` — overwrite the current tab's layout with the workspace |

Workspace files themselves live under `~/.partty/workspaces/` — see [workspaces.toml.md](workspaces.toml.md).

## `[notifications]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | bool | `false` | enable process completion toasts |
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

## `[editor]`

Ctrl+Alt+click on a path in a terminal pane opens a new split pane that
starts directly in the configured editor. The `~path~` placeholder inside `command`
resolves at click time to the path under the cursor — relative fragments are
expanded against the pane's cwd, and the path is translated into the target
shell's dialect (e.g. `/mnt/c/...` in a WSL profile, `/c/...` in git-bash,
`\\wsl$\...` when a WSL path reaches an NTFS-native profile).

```toml
[editor]
split_type = "v"      # "v"/"vertical" | "h"/"horizontal"
profile = "pwsh"      # profile id; empty → the default profile
command = "nvim ~path~"
```

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `split_type` | string | `"v"` | `"v"`/`"vertical"` opens adjacent (side-by-side); `"h"`/`"horizontal"` stacks (top-bottom); anything else falls back to `"v"` |
| `profile` | string | `""` | Profile id; empty → `[profiles].default` |
| `command` | string | `""` | Command template with `~path~`, run at shell startup. Empty → Ctrl+Alt+click disabled |

## `[dev.perf]`

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `enable` | bool | `false` | |
| `console` | bool | `false` | |
| `console_interval_ms` | u32 | `5000` | `1000`–`60000` |

---

## Minimal Example

```toml
[profiles]
default = "local-pwsh"
shell = "pwsh"

[font]
size = 13.0

[pane]
blur = true
corner_radius = 0.0
square = true

[theme]
active = "tokyonight"
variant = "moon"

[editor]
split_type = "v"
profile = "local-pwsh"
command = "nvim ~path~"
```
