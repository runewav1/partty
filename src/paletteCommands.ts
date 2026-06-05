/** Mirrors Rust `SavedPaletteCommand` / JSON from `get_palette_commands`. */
export type SavedPaletteCommand = {
  id: string;
  name: string;
  command: string;
  shell: string;
  cwd_scope: string | null;
};

export type PaletteContext = {
  shell: string;
  cwd: string | null;
};

export function normalizePathKey(p: string): string {
  return p
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Whether a saved command applies in the current shell + directory context. */
export function savedCommandMatchesContext(
  cmd: SavedPaletteCommand,
  ctx: PaletteContext,
): boolean {
  const wantShell = cmd.shell.trim().toLowerCase();
  const curShell = ctx.shell.trim().toLowerCase();
  if (wantShell !== curShell) return false;
  if (cmd.cwd_scope == null || cmd.cwd_scope === "") return true;
  const scope = normalizePathKey(cmd.cwd_scope);
  const cur = ctx.cwd ? normalizePathKey(ctx.cwd) : "";
  if (!cur) return false;
  return cur === scope || cur.startsWith(scope + "/");
}
