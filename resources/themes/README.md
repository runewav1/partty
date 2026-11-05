# Optional theme presets

Copy any `.toml` files you want to `~/.partty/themes/`, then open **Theme** (or
**Pane theme**) in the command palette. Files are not installed automatically.
The picker has no choices until at least one theme file is installed; it then
also offers **Partty** so you can return to the default.

These are the former built-in palettes, including all variants and all 16 ANSI
colors, extracted unchanged. They contain only `[colors]`: **no `[prefs]` or
configuration overrides**. Partty's sole embedded theme uses the former
Carbonfox colors; `carbonfox.toml` is included for completeness.

Multi-variant families share one file, e.g. `catppuccin.toml` or `gruvbox.toml`.
The filename (without `.toml`) is its slug:

```toml
# In config.toml:
[theme]
active = "custom:catppuccin"
variant = "latte"
```

Profiles may use `theme = "catppuccin/latte"`. Theme IDs are not migrated:
old built-in names and missing preset files fall back to Partty. To use a
preset, install its file and explicitly select its new theme ID.

Variants are ordered `[[variants]]` entries, each with its own `id`, `name`, and
`[variants.colors]`. You can also add a separate file to any family with
`family = "catppuccin"` (or any family ID you choose). This lets you group
unrelated favorite palettes into one cycle. See the [theme format](../../docs/config/themes.toml.md).

Tap **Alt+T** to cycle the current app theme family; hold it to open a picker
showing only that family. The shortcut is configurable as `theme_family_cycle`.
