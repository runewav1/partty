# `keybinds.toml`

**Path:** `~/.partty/keybinds.toml`

Defaults apply unless overridden. The file need only contain changed bindings.

> **Reload semantics:** the file is read once at startup (there is no live file
> watcher), so **manual edits take effect on the next launch**. In-app changes
> that go through the keybind IPC apply immediately, and the help/command-palette
> hotkey surface always reflects the currently loaded bindings.

## Format

```
modifier+Key
```

- **Modifiers:** `Ctrl` `Alt` `Shift` `Meta` — order irrelevant, case-insensitive
- **Key:** `KeyboardEvent.key` value (e.g. `A`, `ArrowLeft`, `Enter`, `,`, `/`)
- **Param placeholder:** `{n}` — digits 0–9; for tab-index actions
- **Special** `RightClick` — right mouse button (paste action only)
- **Wheel keys:** `WheelUp`, `WheelDown`, `Wheel` — wheel scroll direction (a
  plain `Wheel` matches either direction). Wheel bindings use **exact** modifier
  matching, so `Ctrl+Shift+WheelUp` never fires a `Ctrl+WheelUp` binding and
  vice-versa; an event that matches no binding keeps normal wheel behavior
  (scrolling, shift-scrollback, …).

## `[bind]`

All configurable actions and their defaults:

| Action | Default |
|--------|---------|
| `pane_split_down` | `Alt+H` |
| `pane_split_right` | `Alt+V` |
| `profile_split_down` | `Alt+Shift+H` |
| `profile_split_right` | `Alt+Shift+V` |
| `pane_close` | `Ctrl+Shift+W` |
| `pane_float_toggle` | `Ctrl+Shift+O` |
| `pane_float_new` | `Alt+O` |
| `profile_float_new` | `Alt+Shift+O` |
| `pane_float_follow` | `Alt+F` |
| `pane_focus_left` | `Alt+ArrowLeft` |
| `pane_focus_right` | `Alt+ArrowRight` |
| `pane_focus_up` | `Alt+ArrowUp` |
| `pane_focus_down` | `Alt+ArrowDown` |
| `pane_swap_left` | `Ctrl+Shift+ArrowLeft` |
| `pane_swap_right` | `Ctrl+Shift+ArrowRight` |
| `pane_swap_up` | `Ctrl+Shift+ArrowUp` |
| `pane_swap_down` | `Ctrl+Shift+ArrowDown` |
| `pane_move_to_tab` | `Ctrl+Shift+{n}` |
| `tab_switch` | `Alt+{n}` |
| `window_toggle` | `Alt+Shift+T` |
| `window_move_next_monitor` | `Alt+Shift+ArrowRight` |
| `window_move_prev_monitor` | `Alt+Shift+ArrowLeft` |
| `window_maximize` | `Alt+Shift+ArrowUp` |
| `window_restore` | `Alt+Shift+ArrowDown` |
| `settings_open` | `Ctrl+,` |
| `palette_open` | `Ctrl+Shift+P` |
| `palette_chord` | `Ctrl+Shift+P` |
| `help_toggle` | `Ctrl+Shift+/` |
| `terminal_find` | `Ctrl+Shift+F` |
| `notification_focus` | `Ctrl+N` |
| `terminal_newline` | `Shift+Enter` |
| `terminal_copy` | `Ctrl+C` |
| `terminal_paste` | `Ctrl+V` |
| `terminal_zoom_in` | `Ctrl+WheelUp` |
| `terminal_zoom_out` | `Ctrl+WheelDown` |
| `terminal_zoom_all_in` | `Ctrl+Shift+WheelUp` |
| `terminal_zoom_all_out` | `Ctrl+Shift+WheelDown` |
| `dev_toggle` | `Ctrl+Shift+D` |

> `terminal_zoom_in` / `terminal_zoom_out` scale the **hovered** terminal's font;
> `terminal_zoom_all_in` / `terminal_zoom_all_out` scale every **visible**
> terminal (active tab tiled + floating, plus follow floats) synchronously.
> Both use the same configured `font.zoom_step` increment (default `0.25`), and
> every pane clamps to 6–32 px independently so differing font sizes keep their
> differences.

## `unbind`

Array of action names to disable entirely.

```toml
unbind = ["pane_close", "dev_toggle"]
```

## Examples

**Change one binding:**

```toml
version = 1

[bind]
pane_split_down = "Ctrl+D"
```

**Swap Vim-style pane focus:**

```toml
version = 1

[bind]
pane_focus_left = "Ctrl+H"
pane_focus_down = "Ctrl+J"
pane_focus_up = "Ctrl+K"
pane_focus_right = "Ctrl+L"
```

**Open profile picker for a split:**

```toml
version = 1

[bind]
profile_split_right = "Alt+Shift+V"
profile_split_down = "Alt+Shift+H"
```

**Customize the split wheel zoom (hovered vs all visible):**

```toml
version = 1

[bind]
# Reverse direction on the hovered terminal: scroll down to zoom in.
terminal_zoom_in = "Ctrl+WheelDown"
terminal_zoom_out = "Ctrl+WheelUp"
# Invert the all-visible zoom too (Shift distinguishes it from hovered zoom).
terminal_zoom_all_in = "Ctrl+Shift+WheelDown"
terminal_zoom_all_out = "Ctrl+Shift+WheelUp"
```

**Disable wheel zoom entirely:**

```toml
version = 1

unbind = ["terminal_zoom_in", "terminal_zoom_out", "terminal_zoom_all_in", "terminal_zoom_all_out"]
```

Right / down respectively. Aliases and profile files: [`profiles.md`](../profiles.md).
