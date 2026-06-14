# portable-pty (patched)

Upstream: https://github.com/wezterm/wezterm/tree/main/pty
Base commit: f8921727a11b9f8b073e8c24821d72fd41283500

## Patch

Commit `45d9b48`: Enables `PSEUDOCONSOLE_PASSTHROUGH_MODE` in
`CreatePseudoConsole` flags so ConPTY passes unrecognized escape
sequences (DCS, APC) through to xterm.js instead of silently dropping
them. Required for Sixel and Kitty graphics protocols.

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

# Re-apply our passthrough patch:
git cherry-pick 45d9b48
# Resolve conflicts if any, then:
git add -A && git cherry-pick --continue

cargo build   # verify
```
