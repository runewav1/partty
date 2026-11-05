# Optional theme presets

Copy any `.toml` files you want to `~/.partty/themes/`, then open **Theme** (or
**Pane theme**) in the command palette. Files are not installed automatically.
The picker has no choices until at least one theme file is installed; it then
also offers **Partty** so you can return to the default.

These are the former built-in palettes, including all variants and all 16 ANSI
colors, extracted unchanged. They contain only `[colors]`: **no `[prefs]` or
configuration overrides**. Partty's sole embedded theme uses the former
Carbonfox colors; `carbonfox.toml` is included for completeness.

Each variant is a separate file, e.g. `catppuccin-latte.toml` or
`gruvbox-soft-light.toml`. The filename (without `.toml`) is its slug:

```toml
# In config.toml:
[theme]
active = "custom:catppuccin-latte"
```

Profiles may use `theme = "catppuccin-latte"`. Theme IDs are not migrated:
old built-in names and missing preset files fall back to Partty. To use a
preset, install its file and explicitly select its new theme ID.
