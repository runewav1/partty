# Workspaces

**Files:** `~/.partty/workspaces/{id}.toml`  
**UI:** Palette → **Save workspace** / **Open workspace**

A workspace is a **saved single-tab pane layout**: split tree, per-pane profile, theme, directory, and optional startup command. Applying a workspace replaces the current tab or opens a new one.

This is separate from **session** prefs in [`config.toml`](config.toml.md) (`[session]`), which control whether tabs/layouts persist in localStorage across restarts.

## File name

The on-disk file stem is derived from the workspace **name** (lowercase, spaces → hyphens, safe characters only), e.g. `Rust dev` → `rust-dev.toml`.

## Top level

| Key | Type | Description |
|-----|------|-------------|
| `version` | u32 | `1` |
| `id` | string | File stem (derived from name on save) |
| `name` | string | Workspace name; also used as the tab title when applied |
| `tab_name` | string | Same as `name` (kept for file compatibility) |

## Layout (`[layout]`)

| Key | Type | Description |
|-----|------|-------------|
| `v` | u32 | `1` |
| `tree` | pane tree | Split/leaf structure (see below) |
| `focused_id` | string | Pane id to focus on load |
| `pane_names` | map | Optional display names per pane id |
| `pane_profile_ids` | map | Connection profile id per pane |
| `pane_themes` | map | Per-pane theme (`ui_theme`, `ui_theme_variant`) |
| `pane_cwds` | map | Starting directory per pane (local/WSL only) |
| `startup_commands` | map | Command run once after shell is ready |

Pane ids in saved files are portable: `root`, `p1`, `p2`, … (not live `wsroot_*` ids).

### Pane tree

Leaves and splits use `kind`:

```toml
[layout.tree]
kind = "leaf"
id = "root"
```

```toml
[layout.tree]
kind = "split"
dir = "h"        # "h" side-by-side, "v" stacked
ratio = 0.5

[layout.tree.a]
kind = "leaf"
id = "root"

[layout.tree.b]
kind = "leaf"
id = "p1"
```

### Per-pane maps

```toml
[layout.pane_profile_ids]
root = "local-default"
p1 = "wsl-ubuntu"

[layout.pane_cwds]
root = "C:\\Users\\Rune\\Development"
p1 = "/mnt/c/Users/Rune/Development"

[layout.pane_themes.root]
ui_theme = "tokyonight"
ui_theme_variant = "default"

[layout.startup_commands]
p1 = "npm run dev"
```

SSH profiles ignore `pane_cwds`.

## Example

```toml
version = 1
id = "rust-dev"
name = "Rust dev"
tab_name = "Rust dev"

[layout]
v = 1
focused_id = "root"

[layout.tree]
kind = "split"
dir = "h"
ratio = 0.55

[layout.tree.a]
kind = "leaf"
id = "root"

[layout.tree.b]
kind = "leaf"
id = "p1"

[layout.pane_profile_ids]
root = "local-default"
p1 = "local-default"

[layout.startup_commands]
p1 = "cargo watch -x check"
```

## Palette

| Command | Action |
|---------|--------|
| Save workspace | Open editor with current tab captured |
| Open workspace | List saved layouts; **Tab** = current tab, **New** = new tab, **Edit** = editor |

Quick save: in the open dialog, type a name and press Enter.
