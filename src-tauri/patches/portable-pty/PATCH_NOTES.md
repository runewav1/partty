# portable-pty (patched)

Upstream: https://github.com/wezterm/wezterm/tree/main/pty
Base commit: f8921727a11b9f8b073e8c24821d72fd41283500

## Patch

Commit `45d9b48`: Enables `PSEUDOCONSOLE_PASSTHROUGH_MODE` in
`CreatePseudoConsole` flags so ConPTY passes unrecognized escape
sequences (DCS, APC) through to xterm.js instead of silently dropping
them. Required for Sixel and Kitty graphics protocols.

Commit `fd5085b`: Modernization pass replaces the legacy Windows dependency stack with `windows-sys`:

- dynamic `conpty.dll` loading via `shared_library` replaced with
  `LoadLibraryW`/`GetProcAddress` behind a `OnceLock`
- the `winreg` registry environment reader replaced with raw `Reg*`
  API calls (`SZ`/`EXPAND_SZ`/`MULTI_SZ` semantics preserved)
- all `winapi` types replaced with `windows-sys` equivalents

## Updating to a new upstream version

```sh
cd patches/portable-pty

# Find the new upstream commit for the desired portable-pty release.
# Use `cargo info portable-pty` or check the WezTerm changelog.

# Fetch the upstream wezterm monorepo.
git fetch upstream

# Checkout your desired upstream base (e.g. a specific commit or tag):
git checkout <new-upstream-commit>

# The portable-pty crate lives at path `pty/` in the wezterm repo.
# Extract it:
git checkout <new-upstream-commit> -- pty/

# Move the pty/ contents to repo root, then:
git add -A
git commit -m "portable-pty X.Y.Z (upstream base)"

# Re-apply our patch(es) -- example:
git cherry-pick 45d9b48

# Resolve conflicts if any, then:
git add -A && git cherry-pick --continue

# Re-apply the windows-sys modernization by hand — it is a dependency-
# stack refactor, not cherry-pickable. Diff it from the previous base,
# e.g. `git diff 45d9b48 <modernization-commit>`, and apply, then:
git add -A && git commit -m "refactor: re-apply windows-sys modernization"

cargo build   # verify
```
