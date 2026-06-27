# `keybinds.toml`

**Path:** `~/.partty/keybinds.toml`

Defaults apply unless overridden. The file need only contain changed bindings.

## Format

```
Modifier+Key
```

- **Modifiers:** `Ctrl` `Alt` `Shift` `Meta` — order irrelevant, case-insensitive
- **Key:** `KeyboardEvent.key` value (e.g. `A`, `ArrowLeft`, `Enter`, `,`, `/`)
- **Param placeholder:** `{n}` — digits 0–9; for tab-index actions
- **Special** `RightClick` — right mouse button (paste action only)

## `[bind]`

All 32 actions and their defaults:

| Action | Default |
|--------|---------|
| `pane.split_down` | `Alt+H` |
| `pane.split_right` | `Alt+V` |
| `pane.close` | `Ctrl+Shift+W` |
| `pane.float_toggle` | `Ctrl+Shift+O` |
| `pane.focus_left` | `Ctrl+ArrowLeft` |
| `pane.focus_right` | `Ctrl+ArrowRight` |
| `pane.focus_up` | `Ctrl+ArrowUp` |
| `pane.focus_down` | `Ctrl+ArrowDown` |
| `pane.swap_left` | `Ctrl+Shift+ArrowLeft` |
| `pane.swap_right` | `Ctrl+Shift+ArrowRight` |
| `pane.swap_up` | `Ctrl+Shift+ArrowUp` |
| `pane.swap_down` | `Ctrl+Shift+ArrowDown` |
| `pane.move_to_tab` | `Ctrl+Shift+{n}` |
| `tab.switch` | `Alt+{n}` |
| `window.toggle` | `Alt+Shift+T` |
| `window.move_next_monitor` | `Alt+Shift+ArrowRight` |
| `window.move_prev_monitor` | `Alt+Shift+ArrowLeft` |
| `window.maximize` | `Alt+Shift+ArrowUp` |
| `window.restore` | `Alt+Shift+ArrowDown` |
| `settings.open` | `Ctrl+,` |
| `palette.open` | `Ctrl+Shift+P` |
| `palette.chord` | `Ctrl+Shift+P` |
| `help.toggle` | `Ctrl+Shift+/` |
| `file_tree.toggle` | `Ctrl+Shift+E` |
| `focus.file_tree` | `Alt+ArrowLeft` |
| `focus.terminal` | `Alt+ArrowRight` |
| `focus.pane_left` | `Alt+ArrowLeft` |
| `focus.pane_right` | `Alt+ArrowRight` |
| `focus.pane_up` | `Alt+ArrowUp` |
| `focus.pane_down` | `Alt+ArrowDown` |
| `terminal.newline` | `Shift+Enter` |
| `terminal.copy` | `Ctrl+C` |
| `dev.toggle` | `Ctrl+Shift+D` |

## `unbind`

Array of action names to disable entirely.

```toml
unbind = ["pane.close", "dev.toggle"]
```

## Examples

**Change one binding:**

```toml
version = 1

[bind]
pane.split_down = "Ctrl+D"
```

**Swap Vim-style pane focus:**

```toml
version = 1

[bind]
pane.focus_left = "Ctrl+H"
pane.focus_down = "Ctrl+J"
pane.focus_up = "Ctrl+K"
pane.focus_right = "Ctrl+L"
```

**Disable close shortcut:**

```toml
version = 1
unbind = ["pane.close"]
```
