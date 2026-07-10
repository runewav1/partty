# `config.toml`

**Path:** `~/.partty/config.toml`

## `[profiles]`

Connection profiles and spawn defaults. Profile definitions live in `~/.partty/profiles/*.toml`. On each list, ParTTY seeds missing files from detected local shells and installed WSL distros (`wsl.exe -l -q`, same discovery Windows Terminal uses).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `default` | string | `"local-default"` | Profile id for new tabs (when `new_tab_uses_default`) and panes without inheritance |
| `shell` | string | `"pwsh"` | Fallback shell when a local profile omits `shell` (incl. `local-default`) |
| `initial_dir` | string or absent | absent | Default start directory (Settings → Start in) |
| `inherit_on_split` | bool | `true` | Splits copy the parent pane's profile |
| `inherit_cwd_on_split` | bool | `true` | Splits copy the parent pane's cwd (Windows-native paths) |
| `palette_tab_picker` | bool | `true` | In the command palette, Tab on New tab / Split opens a profile list |
| `new_tab_uses_default` | bool | `true` | New tabs use `default` instead of the focused pane's profile |
| `omit` | string[] | `[]` | Profile ids hidden from pickers / Settings (files stay on disk) |
| `palette_icons` | bool | `true` | Show cached exe icons next to profiles in the `@profile` palette |

```toml
[profiles]
default = "local-pwsh"
shell = "pwsh"
# initial_dir = "C:\\Users\\you"
omit = ["local-powershell", "wsl-docker-desktop"]
palette_icons = true
```

> **Removed:** The old top-level `[shell]` section is gone. Use `[profiles].shell` / `[profiles].initial_dir`.

### Profile files (`~/.partty/profiles/`)

Each `*.toml` file is one profile. Seeded examples:

| File | Meaning |
|------|---------|
| `local-default.toml` | Follows `[profiles].shell` |
| `local-pwsh.toml` | `pwsh` |
| `local-powershell.toml` | `powershell` |
| `local-cmd.toml` | `CMD` |
| `local-bash.toml` | `bash` (when detected) |
| `wsl-ubuntu.toml` | WSL distro (`kind = "wsl"`, `wsl_distro = "Ubuntu"`) |

```toml
version = 1
id = "local-pwsh"
name = "pwsh"           # friendly UI name (alias: display_name)
kind = "local"
shell = "pwsh"
# initial_cwd = "C:\\Users\\you\\code"  # optional; overrides [profiles].initial_dir
builtin = true
```

```toml
version = 1
id = "wsl-archlinux"
name = "Arch Linux"     # rename freely; spawn still uses wsl_distro
kind = "wsl"
wsl_distro = "archlinux"
builtin = true
```

SSH profiles are **manual only** (no in-app profile builder). Drop a TOML file under `~/.partty/profiles/`:

```toml
version = 1
id = "ssh-prod"
name = "Prod"                 # friendly UI name
kind = "ssh"
ssh_host = "prod.example.com" # or user@host, or an ~/.ssh/config Host alias
ssh_user = "deploy"           # optional if not in ssh_host / config
ssh_port = 22                 # optional
ssh_identity_file = "C:\\Users\\you\\.ssh\\id_ed25519"  # optional
ssh_args = ["-o", "ForwardAgent=yes"]                  # optional extra OpenSSH args
# startup_command = "tmux attach -t main || tmux new -s main"  # optional remote cmd (-t)
```

Or a full Windows Terminal–style commandline (ignores structured `ssh_*` fields):

```toml
version = 1
id = "ssh-bastion"
name = "Bastion"
kind = "ssh"
commandline = "ssh -J jump.example.com deploy@10.0.0.5"
```

`kind` may be `local`, `wsl`, or `ssh`. Local empty / omitted `shell` uses `[profiles].shell`. Optional `initial_cwd` on a profile overrides `[profiles].initial_dir` for that profile only (pane/split cwd still wins when set). WSL spawns `wsl.exe -d <wsl_distro>` (optional `--cd` from Start in / pane cwd / profile `initial_cwd`). SSH spawns OpenSSH (`ssh.exe`) from structured fields or `commandline`. `name` / `display_name` is display-only.

Optional per-profile `icon` overrides auto-extract (path to `.ico`, `.png`, or `.exe`):

```toml
icon = "C:\\Icons\\prod.ico"
```

Icons are resolved like Windows Terminal when possible: local shells use WT’s bundled `ProfileIcons` PNGs; WSL uses each distro’s `shortcut.ico` (`%LOCALAPPDATA%\wsl\{guid}\` / Lxss `BasePath`). Optional per-profile `icon` overrides that. Extracting from `.exe` is only a fallback. Cached under `~/.partty/cache/icons/` when `palette_icons = true`.

The file name should be `{id}.toml` (letters, numbers, `-`, `_` only), e.g. `ssh-prod.toml`. The in-file `id` should match the stem.

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
| `backspace_deletes_selection` | bool | `true` | Backspace deletes a single-line selection on the cursor line (sends arrow keys + DEL to the shell; no-op for multi-line / scrollback) |

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

Hyprland-inspired insert rules for new panes (existing trees are not rewritten when you change the style):

| Value | Behavior |
|-------|----------|
| `balanced` | Manual splits. `Alt+V` / `Alt+H` (split right / down) are honored; new pane gets 50% of the focused leaf. |
| `dwindle` | BSP-style. Direction is chosen from the focused pane’s aspect ratio (`W ≥ H` → side-by-side, else stacked). Hotkey direction is only a fallback when size is unknown. Ratio stays 50/50. |
| `master` | Left master column is the tab root pane (~68% width). Further splits append vertically into the right-hand stack. If the tree is not already master-shaped (e.g. after using balanced), the next split falls back to a normal focused split until a clean master root can be formed. |

## `[window]`

| Key | Type | Default | Values |
|-----|------|---------|--------|
| `always_on_top` | bool | `false` | |
| `summon_maximized` | bool | `false` | |
| `summon_at_cursor` | bool | `false` | place window at OS cursor on show |
| `hidden_from_taskbar` | bool | `false` | |
| `startup_visible` | bool | `true` | show window immediately on launch; disable to require summon keybind |
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
| `right_click_paste` | bool | `true` | right-click in a terminal pane pastes from the clipboard |
| `retain_session_state` | bool | `true` | keep pane layouts and working directories across restarts |

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
```
