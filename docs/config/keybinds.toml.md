# `keybinds.toml`

**Path:** `~/.partty/keybinds.toml`

Defaults apply unless overridden. The file need only contain changed bindings.

## Format

```
modifier+Key
```

- **Modifiers:** `Ctrl` `Alt` `Shift` `Meta` — order irrelevant, case-insensitive
- **Key:** `KeyboardEvent.key` value (e.g. `A`, `ArrowLeft`, `Enter`, `,`, `/`)
- **Param placeholder:** `{n}` — digits 0–9; for tab-index actions
- **Special** `RightClick` — right mouse button (paste action only)

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
| `pane_focus_left` | `Ctrl+ArrowLeft` |
| `pane_focus_right` | `Ctrl+ArrowRight` |
| `pane_focus_up` | `Ctrl+ArrowUp` |
| `pane_focus_down` | `Ctrl+ArrowDown` |
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
| `focus_terminal` | `Alt+ArrowRight` |
| `focus_pane_up` | `Alt+ArrowUp` |
| `focus_pane_down` | `Alt+ArrowDown` |
| `terminal_newline` | `Shift+Enter` |
| `terminal_copy` | `Ctrl+C` |
| `terminal_paste` | `Ctrl+V` |
| `dev_toggle` | `Ctrl+Shift+D` |

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

Right / down respectively. Aliases and profile files: [`profiles.md`](../profiles.md).
