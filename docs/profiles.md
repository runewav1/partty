# Profiles

**Definitions:** `~/.partty/profiles/{id}.toml`  
**Behavior:** `[profiles]` in [`config.toml`](config/config.toml.md)

One file per profile. Local and WSL profiles are seeded when missing (detected shells + `wsl.exe -l -q`). SSH profiles are manual only.

File name stem must match `id` (letters, numbers, `-`, `_` only).

## Kinds

| `kind` | Spawns | Required fields |
|--------|--------|-----------------|
| `local` | Host shell | — (`shell` empty → `[profiles].shell`) |
| `wsl` | `wsl.exe -d <distro>` | `wsl_distro` |
| `ssh` | OpenSSH `ssh.exe` | `ssh_host` or `commandline` |

`name` / `display_name` is display-only. Spawn uses `shell`, `wsl_distro`, or SSH fields.

## Common fields

| Key | Type | Description |
|-----|------|-------------|
| `version` | u32 | `1` |
| `id` | string | Stable id; must match file stem |
| `name` | string | Palette / UI label |
| `kind` | string | `local` `wsl` `ssh` |
| `initial_cwd` | string | Start directory; overrides `[profiles].initial_dir`. Pane/split cwd still wins when set |
| `icon` | string | Path to `.ico` / `.png` / `.exe`; overrides auto icon |
| `theme` | string | Pane color theme: `id`, `id/variant`, or custom theme slug (see below) |
| `builtin` | bool | Seeded profile (still editable) |
| `base` | string | Spawn using another profile |
| `startup_command` | string | Command to run after the shell is ready |
| `inherit_cwd` | bool | Override `[profiles].inherit_cwd_on_split` for splits into this profile |

Workspace per-pane `startup_commands` override profile `startup_command` when both apply.

### Profile theme

Optional. Applies **colors only** to panes spawned with this profile (same as Palette → Pane theme). Theme.toml `[prefs]` are **not** applied — those only take effect when the theme is set as the **app** theme.

| Value | Meaning |
|-------|---------|
| omitted / empty | Use the current app theme |
| `tokyonight` | Built-in theme, default variant |
| `github/dark` | Built-in theme + variant (`/` separates variant) |
| `soft-amber` | Custom `~/.partty/themes/soft-amber.toml` (no `custom:` prefix) |

Deprecated combined ids such as `github-dark` / `vscode-light` still load (mapped to
`github` + `dark`, etc.) but prefer `name/variant`. Do not use `{name} dark — default`.

Persisted per-pane theme overrides (layout / Pane theme) still win over the profile default.

```toml
version = 1
id = "wsl-ubuntu"
name = "Ubuntu"
kind = "wsl"
wsl_distro = "Ubuntu"
theme = "github/dark"
```

## Local

| Key | Type | Description |
|-----|------|-------------|
| `shell` | string | Executable or name on `PATH`. Empty → `[profiles].shell` |

```toml
version = 1
id = "local-pwsh"
name = "pwsh"
kind = "local"
shell = "pwsh"
```

`local-default` uses `[profiles].shell` when `shell` is omitted.

## WSL

| Key | Type | Description |
|-----|------|-------------|
| `wsl_distro` | string | Distro name as listed by `wsl.exe -l -q` |

```toml
version = 1
id = "wsl-ubuntu"
name = "Ubuntu"
kind = "wsl"
wsl_distro = "Ubuntu"
```

Rename `name` freely; spawn always uses `wsl_distro`. Cwd uses Windows or Linux paths via `wsl --cd` (Start in / pane cwd / `initial_cwd`).

Reinstalling or changing distros: update or delete the profile file, or let ParTTY seed a new one on next list. Hide stale ids with `[profiles].omit`.

## SSH

ParTTY does not store keys or passwords. Auth is OpenSSH (and optionally the Windows OpenSSH Authentication Agent).

### Structured fields

Used when `commandline` is unset:

| Key | Type | Description |
|-----|------|-------------|
| `ssh_host` | string | Host, `user@host`, or `~/.ssh/config` Host alias |
| `ssh_user` | string | Optional if not in `ssh_host` / config |
| `ssh_port` | u16 | Optional (`-p`) |
| `ssh_identity_file` | string | Private key path (`-i`). OpenSSH formats only (e.g. ed25519, RSA, PEM) |
| `ssh_args` | string[] | Extra client args |

```toml
version = 1
id = "ssh-prod"
name = "Prod"
kind = "ssh"
ssh_host = "prod.example.com"
ssh_user = "deploy"
ssh_port = 22
ssh_identity_file = "C:\\Users\\you\\.ssh\\id_ed25519"
ssh_args = ["-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"]
```

### `commandline` override

When set, structured `ssh_*` fields are ignored. Full OpenSSH (or other) command:

```toml
version = 1
id = "ssh-bastion"
name = "Bastion"
kind = "ssh"
commandline = "ssh -i C:\\Users\\you\\.ssh\\id_ed25519 -J jump.example.com deploy@10.0.0.5"
```

### Passwordless login

1. Create or use an OpenSSH key (not PuTTY `.ppk` — convert with `puttygen` first).
2. Install the public key on the server (`authorized_keys`).
3. Point the profile at the private key (`ssh_identity_file` or `-i` in `commandline`), **or** use a Host entry in `~/.ssh/config` and set `ssh_host` to that alias.
4. Passphrase-protected keys: unlock via the OS ssh-agent once; do not put passphrases in profile files.

Useful OpenSSH options (via `ssh_args` or `commandline`):

| Option | Role |
|--------|------|
| `IdentitiesOnly=yes` | Use only the specified key |
| `BatchMode=yes` | Fail instead of prompting for a password |
| `ForwardAgent=yes` | Agent forwarding (use deliberately) |

## Behavior (`config.toml`)

| Key | Default | Description |
|-----|---------|-------------|
| `default` | `"local-default"` | Profile for new tabs when `new_tab_uses_default` |
| `shell` | `"pwsh"` | Fallback for local profiles with no `shell` |
| `initial_dir` | absent | Default start directory |
| `inherit_on_split` | `true` | Splits copy parent profile |
| `inherit_cwd_on_split` | `true` | Splits copy parent cwd |
| `palette_tab_picker` | `true` | Tab on New tab / Split opens profile picker |
| `new_tab_uses_default` | `true` | New tabs use `default`, not focused profile |
| `omit` | `[]` | Hide profile ids from pickers (files remain) |
| `palette_icons` | `true` | Icons in profile picker |

### Selection aliases

Config-only (`[profiles.selection_aliases]`). Not in Settings; Settings saves preserve the table.

| Rule | Detail |
|------|--------|
| Key | Single character, **case-sensitive** (`a` ≠ `A`) |
| Value | Profile `id` |
| When | Empty filter in the profile picker only |
| Conflict | Same key → two different ids: that key is disabled; other aliases and all profiles still work |

```toml
[profiles.selection_aliases]
a = "wsl-ubuntu"
A = "local-pwsh"
s = "ssh-prod"
```

Picker: empty field, placeholder **Profile**; type to filter (case-insensitive). Hotkeys: [`profile_split_right` / `profile_split_down`](config/keybinds.toml.md).

## Opening profiles

| Method | How |
|--------|-----|
| Palette | `@profile:new-tab` / `@profile:split-h` / `@profile:split-v`, or Tab on New tab / Split |
| Split keybinds | `Alt+Shift+V` (right) / `Alt+Shift+H` (down) → picker |
| Alias | With empty filter, press the configured character |

## Icons

Auto icons follow Windows Terminal where possible (shell PNGs, WSL `shortcut.ico`). `icon` overrides. Cached under `~/.partty/cache/icons/` when `palette_icons = true`.

## Seeded examples

| File | Role |
|------|------|
| `local-default.toml` | `[profiles].shell` |
| `local-pwsh.toml` | `pwsh` |
| `local-powershell.toml` | Windows PowerShell |
| `local-cmd.toml` | CMD |
| `local-bash.toml` | bash (if detected) |
| `wsl-*.toml` | One per installed distro |
