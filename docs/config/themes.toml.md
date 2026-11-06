# `themes/<name>.toml`

**Path:** `~/.partty/themes/<name>.toml`
**Format:** TOML
**Creation:** manually authored

The only embedded theme is **Partty** (the former Carbonfox palette). Optional
presets live in [`resources/themes/`](../../resources/themes/); copy the files
you want into the path above. Nothing is installed automatically. With no
installed files, the theme picker offers no changes. With installed files, it
also offers Partty to return to the default. Presets with several variants are
organized into one file per family. These resources are colors-only and never
override configuration. There is no migration of old theme IDs.

## Sections

### `version`

Always `1`.

### `name`

Display name (cosmetic, defaults to filename stem).

### `family`

Optional family ID, defaulting to the filename stem. Give multiple files the
same `family` to include them in one cycle. Membership is explicit: palettes
do not need to look alike. The picker uses display names, without a “Custom”
prefix. Files are ordered by filename, variants by declaration order.

### `[[variants]]`

Optional ordered variants within a file. Each has a unique `id`, an optional
display `name` (defaults to its ID), `[variants.colors]`, and optional
`[variants.prefs]`. Variant colors override shared root `[colors]`; variant
preferences overlay root `[prefs]`. A file without variants is a single theme.
With variants, the root is shared data, not an extra picker entry.

```toml
version = 1
name = "Catppuccin"
family = "catppuccin" # optional; also the filename in this example

[[variants]]
id = "mocha"
name = "Mocha"
[variants.colors]
"--term-bg" = "#1e1e2e"
"--term-fg" = "#cdd6f4"

[[variants]]
id = "latte"
name = "Latte"
[variants.colors]
"--term-bg" = "#eff1f5"
"--term-fg" = "#4c4f69"
```

Select it in `config.toml` with:

```toml
[theme]
active = "custom:catppuccin"
variant = "latte"
```

`variant = "default"` (or omitted) selects the first declared variant.
An unknown explicit variant or missing theme falls back to Partty. Profiles
may use `theme = "catppuccin/latte"`; pane/profile themes never apply `[prefs]`.

A separate `favorite.toml` can join this family with `family = "catppuccin"`
and its own `name` and `[colors]`, without nesting any variants. It is selected
as `active = "custom:favorite"`, `variant = "default"`.

### Family shortcut

`Alt+T` (`theme_family_cycle` in `keybinds.toml`) selects the next member of the
**active app theme's family** when released within 350 ms, wrapping at the end.
Holding for 350 ms instead opens the theme picker restricted to that family,
without cycling first. Repeated keydown events do nothing. Release after a hold
leaves the picker open; Escape restores the original theme. Losing window focus
cancels an unfinished gesture. A family with fewer than two members does nothing.

Families group installed files only. Nothing is installed automatically, and
Windows light/dark preference matching is not implemented yet.
The built-in Partty theme belongs to family `partty`; a separate file can use
`family = "partty"` to cycle alongside the built-in default.

### `[colors]`

Flat key-value map of CSS custom properties. Keys are CSS variable names.

```toml
[colors]
--term-bg = "#1a1b26"
--term-fg = "#c0caf5"
--accent-primary = "#7aa2f7"
--ui-gray-900 = "#16161e"
```

Common keys:

| Key                                                     | Purpose                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `--term-bg`                                             | Terminal background                                                              |
| `--term-fg`                                             | Terminal foreground                                                              |
| `--term-cursor`                                         | Cursor color                                                                     |
| `--term-selection-bg`                                   | Selection background                                                             |
| `--term-ansi-black` … `--term-ansi-white`               | The eight ordinary terminal ANSI colors                                          |
| `--term-ansi-bright-black` … `--term-ansi-bright-white` | The eight bright terminal ANSI colors                                            |
| `--term-find-match-bg`                                  | Find-in-terminal match tint (defaults to a `--term-bg`→`--accent-primary` blend) |
| `--term-find-match-fg`                                  | Match text color (defaults to a legible contrast color)                          |
| `--term-find-match-active-bg`                           | Active find-in-terminal match tint (defaults to a stronger blend)                |
| `--term-find-match-active-fg`                           | Active match text color (defaults to a legible contrast color)                   |
| `--accent-primary`                                      | Accent (borders, highlights)                                                     |
| `--accent-primary-light`                                | Accent lighter shade                                                             |
| `--ui-gray-50`–`--ui-gray-900`                          | Grayscale ramp                                                                   |
| `--panel-bg`                                            | Panel backgrounds                                                                |
| `--panel-border`                                        | Panel borders                                                                    |
| `--input-bg`                                            | Input backgrounds                                                                |
| `--input-border`                                        | Input borders                                                                    |
| `--pane-divider`                                        | Pane divider                                                                     |
| `--pane-divider-hover`                                  | Pane divider hover                                                               |

Explicit terminal foreground/cursor and ANSI colors are used unchanged for both
app and pane themes. Missing ANSI entries use the generic dark/light terminal
palette. Select an installed file with `[theme] active = "custom:<filename>"`;
use `active = "partty"` for the embedded default.

### `[prefs]`

Optional. Overrides `config.toml` **only when this theme is set as the app theme**
(Theme picker → app, or `[theme]` in config). Any section from `config.toml` is valid
here. Omitted sections/fields fall back to the user's `config.toml`.

**Not applied** when the theme is used as a **pane** theme or a **profile** `theme` —
those paths are colors-only (subtractive: `[prefs]` is ignored).

## Examples

**Minimal (colors only):**

```toml
version = 1
name = "my-theme"

[colors]
--term-bg = "#1a1b26"
--term-fg = "#c0caf5"
--accent-primary = "#7aa2f7"
--ui-gray-900 = "#16161e"
--ui-gray-800 = "#1f2335"
```

**With preference overrides:**

```toml
version = 1
name = "soft-amber"

[colors]
--term-bg = "#1a1816"
--term-fg = "#ebdbb2"
--accent-primary = "#d79921"

[prefs.pane]
blur = true
corner_radius = 8.0

[prefs.cursor]
style = "bar"
blink = false

[prefs.font]
size = 13.0
```

When this theme is applied **as the app theme**, `pane.blur`, `pane.corner_radius`,
`cursor.style`, `cursor.blink`, and `font.size` are set from the theme. All other
preferences remain as defined in `config.toml`. Pane and profile themes use only
`[colors]`.
