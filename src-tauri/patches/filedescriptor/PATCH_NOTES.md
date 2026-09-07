# filedescriptor (patched)

Upstream: https://github.com/wezterm/wezterm/tree/main/filedescriptor
Base commit: d2f3f05b38f26a872f4b0bfbb3d2eaa7bdfc1b0b

## Patches applied on top of the base

### Normalize workspace dependencies to standalone versions

The live state in the wezterm monorepo references workspace-level
dependencies (`thiserror.workspace`, `libc.workspace`,
`windows-sys.workspace`). As a standalone patch crate these are resolved
to explicit versions so the crate builds outside the wezterm workspace:

- `thiserror` → `1.0`
- `libc` → `0.2`
- `windows-sys` → `0.61` with the same feature set declared upstream
  (`Win32_Foundation`, `Win32_Networking_WinSock`, `Win32_Security`,
  `Win32_Storage_FileSystem`, `Win32_System_Console`, `Win32_System_IO`,
  `Win32_System_Pipes`, `Win32_System_Threading`)

### Resolve clippy warnings and apply cargo fmt

- `clippy::derivable_impls`: `HandleType` derives `Default` with the
  `Unknown` variant marked `#[default]` instead of a manual impl
- `clippy::ptr_eq`: raw handle comparisons against `INVALID_HANDLE_VALUE`
  use `std::ptr::eq`
- `clippy::unnecessary_mut_passed` / `unused_mut`: `SECURITY_ATTRIBUTES`
  no longer needs `mut` when passed to `CreatePipe`
- `clippy::useless_transmute`: `socketpair` uses explicit `SOCKADDR_IN` to
  `SOCKADDR` pointer casts instead of `std::mem::transmute`
- `clippy::missing_safety_doc`: added `# Safety` sections to
  `from_raw_file_descriptor` and `from_socket_descriptor`

## Rationale

The crates.io release `filedescriptor 0.8.3` still depends on `winapi`
for its Windows layer. The wezterm repository has since migrated the
crate to `windows-sys`; this patched copy tracks that current live state
so `portable-pty` (and everything above it) avoids `winapi` in favor of
`windows-sys`.

## Notes

This directory is intentionally not its own git repository (unlike the
`portable-pty` patch). The crate source is version-controlled by the
outer ParTTY repository; `PATCH_NOTES.md` is the record of the upstream
base commit and the local modifications applied on top of it.

## Updating to a new upstream version

```sh
# Fetch the current filedescriptor/ directory from the wezterm repo at
# the desired commit (or main) and copy the files over the vendored copy:
#   src/Cargo.toml, src/lib.rs, src/unix.rs, src/windows.rs,
#   LICENSE.md, README.md

# Re-apply the patches from this document by hand:
# 1. Normalize workspace dependencies to standalone versions in Cargo.toml.
# 2. Resolve clippy warnings and apply cargo fmt (may need manual
#    resolution against the new base).

# Record the new base commit at the top of this file.

cargo build   # verify
```