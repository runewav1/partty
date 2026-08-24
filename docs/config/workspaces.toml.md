# Workspaces

**Files:** `~/.partty/workspaces/{id}.toml`

A workspace is a single-tab terminal layout. It describes the pane tree and the settings used to start each pane: connection profile, theme, starting directory, startup command, and floating-pane state.

Invalid files are rejected when they are read.

Workspaces are separate from session preferences in [`config.toml`](config.toml.md). The `[session]` settings control whether the live tab and pane layout are retained in browser storage across restarts.

Open a workspace from the command palette (**Open workspace…**). Where it opens — a new tab, or overwriting the current tab — is set by `[workspaces].open_mode` in [`config.toml`](config.toml.md).

## File name and identity

The file name is the workspace ID:

```text
~/.partty/workspaces/rust-dev.toml
```

The ID must be 1–64 characters containing only ASCII letters, numbers, `-`, or `_`. The `id` field inside the file must match the file stem exactly.

## Top level

| Key | Type | Description |
|-----|------|-------------|
| `version` | integer | Workspace schema version. Must be `1`. |
| `id` | string | ID matching the file stem. |
| `name` | string | Human-readable workspace name, 1–128 characters. |
| `tab_name` | string, optional | Explicit name for the tab created from this workspace. If omitted, the normal tab naming behavior is used. |
| `layout` | table | Pane layout and per-pane configuration. |

Unknown keys are rejected. This keeps spelling mistakes from silently changing how a workspace starts.

## Layout (`[layout]`)

| Key | Type | Description |
|-----|------|-------------|
| `tree` | pane tree | Split and leaf structure. |
| `focused_id` | string | ID of the pane that receives focus. It must occur in the tree. |
| `floating` | map | Optional floating state keyed by pane ID. |
| `pane_themes` | map | Optional per-pane theme settings. |
| `pane_cwds` | map | Optional per-pane starting directories. |
| `pane_profile_ids` | map | Optional connection profile IDs. |
| `startup_commands` | map | Optional per-pane commands injected during PTY startup. |

Every key in a per-pane map must refer to a leaf in `tree`. Pane IDs are local to the file and should be stable, readable values such as `root`, `editor`, and `logs`.

### Pane tree

A single pane is a leaf:

```toml
[layout.tree]
kind = "leaf"
id = "root"
```

A split has two child nodes, `a` and `b`. `h` places panes side by side and `v` stacks them. `ratio` must be between `0.05` and `0.95`.

`ratio` is **local to that split**, not a fraction of the whole workspace. It is the share of the split's own area given to child `a`; child `b` receives the remainder (`1 - ratio`). When a pane is split, the original pane becomes `a` and the newly created pane becomes `b` — so the ratio is "in relation to the pane it splits from": it controls how much of the parent's space the original pane keeps. `0.5` gives both children equal space. A pane's actual on-screen size is the product of every ancestor split's ratio along the root-to-leaf path.

```toml
[layout.tree]
kind = "split"
dir = "h"
ratio = 0.55

[layout.tree.a]
kind = "leaf"
id = "root"

[layout.tree.b]
kind = "leaf"
id = "logs"
```

Pane IDs must be unique, and the tree must contain at least one leaf.

### Profiles, directories, and startup commands

`pane_profile_ids` refers to profile IDs from the profiles configuration. If a pane has no entry, the normal default profile is used.

`pane_cwds` supplies the starting directory for the selected profile. Use the path syntax appropriate for that profile:

- local profiles use host paths, such as `C:\\Users\\Rune\\Development`;
- WSL profiles use WSL paths, such as `/mnt/c/Users/Rune/Development` (Windows drive paths are also normalized for WSL);
- SSH profiles generally do not use a local starting directory.

`startup_commands` contains one nonempty command string per pane. ParTTY passes this command into the PTY's spawn-time startup command, using the selected profile's shell/connection behavior. It is not typed into an already-running terminal after startup, so the shell starts directly at the requested command without a follow-up injection.

```toml
[layout.pane_profile_ids]
root = "local-default"
logs = "wsl-ubuntu"

[layout.pane_cwds]
root = "C:\\Users\\Rune\\Development"
logs = "/mnt/c/Users/Rune/Development"

[layout.startup_commands]
logs = "npm run dev"
```

### Themes

A theme entry requires both the theme ID and its variant:

```toml
[layout.pane_themes.root]
ui_theme = "tokyonight"
ui_theme_variant = "default"
```

### Floating panes

A pane listed in `floating` starts as a floating pane. Coordinates and dimensions are logical window values; `width` and `height` must be positive. `z` controls stacking order. `follow` preserves the existing floating-pane follow behavior.

```toml
[layout.floating.logs]
x = 80.0
y = 48.0
width = 720.0
height = 420.0
z = 1.0
follow = false
```

A pane may have entries in both `floating` and the other per-pane maps. Its profile, theme, directory, and startup command still apply when it is started.

## Complete example

```toml
version = 1
id = "rust-dev"
name = "Rust development"
tab_name = "Rust"

[layout]
focused_id = "root"

[layout.tree]
kind = "split"
dir = "h"
ratio = 0.55

[layout.tree.a]
kind = "leaf"
id = "root"

[layout.tree.b]
kind = "split"
dir = "v"
ratio = 0.65

[layout.tree.b.a]
kind = "leaf"
id = "editor"

[layout.tree.b.b]
kind = "leaf"
id = "logs"

[layout.pane_profile_ids]
root = "local-default"
editor = "local-default"
logs = "wsl-ubuntu"

[layout.pane_cwds]
root = "C:\\Users\\Rune\\Development\\rust-app"
editor = "C:\\Users\\Rune\\Development\\rust-app"
logs = "/mnt/c/Users/Rune/Development/rust-app"

[layout.pane_themes.root]
ui_theme = "tokyonight"
ui_theme_variant = "default"

[layout.startup_commands]
logs = "cargo watch -x check"

[layout.floating.editor]
x = 120.0
y = 72.0
width = 900.0
height = 600.0
z = 2.0
follow = false
```


