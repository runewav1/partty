/**
 * Lightweight ASCII glyph + color map for the file tree.
 *
 * The only unique identifier per file is the color of the pre-name glyph,
 * resolved from the file's extension (or special filename). Folders render
 * `name/` with no marker.
 *
 * Colors are the language's conventional brand colors so recognizable files
 * stay visually familiar even without real icons.
 */

export type FileGlyph = {
  /** Symbol or short character shown before the file name (no trailing space). */
  glyph: string;
  /** CSS color (hex) applied to the glyph. */
  color: string;
};

const DEFAULT_GLYPH: FileGlyph = { glyph: "›", color: "var(--file-tree-glyph-default, #8a8f98)" };

const EXT_GLYPH: Record<string, FileGlyph> = {
  // ── programming languages ───────────────────────────────────────────
  rs: { glyph: "rs", color: "#dea584" },
  go: { glyph: "go", color: "#00add8" },
  c: { glyph: "c", color: "#5599cc" },
  h: { glyph: "h", color: "#5599cc" },
  cpp: { glyph: "c+", color: "#f34b7d" },
  cc: { glyph: "c+", color: "#f34b7d" },
  cxx: { glyph: "c+", color: "#f34b7d" },
  hpp: { glyph: "h+", color: "#f34b7d" },
  hxx: { glyph: "h+", color: "#f34b7d" },
  hh: { glyph: "h+", color: "#f34b7d" },
  cs: { glyph: "c#", color: "#178600" },
  java: { glyph: "jv", color: "#b07219" },
  kt: { glyph: "kt", color: "#a97bff" },
  kts: { glyph: "kt", color: "#a97bff" },
  swift: { glyph: "sw", color: "#fa7343" },
  scala: { glyph: "sc", color: "#c22d40" },
  clj: { glyph: "cl", color: "#db5855" },
  cljs: { glyph: "cl", color: "#db5855" },
  cljc: { glyph: "cl", color: "#db5855" },
  edn: { glyph: "ed", color: "#db5855" },
  hs: { glyph: "hs", color: "#5e5086" },
  lhs: { glyph: "hs", color: "#5e5086" },
  ml: { glyph: "ml", color: "#3a73a1" },
  mli: { glyph: "ml", color: "#3a73a1" },
  fs: { glyph: "fs", color: "#b845fc" },
  fsx: { glyph: "fs", color: "#b845fc" },
  fsi: { glyph: "fs", color: "#b845fc" },
  elm: { glyph: "el", color: "#60b5cc" },
  erl: { glyph: "er", color: "#b83998" },
  ex: { glyph: "ex", color: "#6e4a7e" },
  exs: { glyph: "ex", color: "#6e4a7e" },
  gleam: { glyph: "gl", color: "#ffaff3" },
  zig: { glyph: "zg", color: "#ec915c" },
  nim: { glyph: "nm", color: "#ffc200" },
  cr: { glyph: "cr", color: "#222222" },
  d: { glyph: "d", color: "#ba595e" },
  v: { glyph: "v", color: "#4f87c4" },
  vala: { glyph: "va", color: "#7e5dab" },
  asm: { glyph: "as", color: "#6e4c13" },
  s: { glyph: "as", color: "#6e4c13" },

  // ── web / scripting ────────────────────────────────────────────────
  js: { glyph: "js", color: "#f7df1e" },
  mjs: { glyph: "js", color: "#f7df1e" },
  cjs: { glyph: "js", color: "#f7df1e" },
  jsx: { glyph: "js", color: "#61dafb" },
  ts: { glyph: "ts", color: "#3178c6" },
  mts: { glyph: "ts", color: "#3178c6" },
  cts: { glyph: "ts", color: "#3178c6" },
  tsx: { glyph: "ts", color: "#61dafb" },
  json: { glyph: "{}", color: "#cbcb41" },
  jsonc: { glyph: "{}", color: "#cbcb41" },
  json5: { glyph: "{}", color: "#cbcb41" },
  html: { glyph: "h≤", color: "#e44d26" },
  htm: { glyph: "h≤", color: "#e44d26" },
  css: { glyph: "#", color: "#563d7c" },
  scss: { glyph: "#", color: "#c6538b" },
  sass: { glyph: "#", color: "#a53d6d" },
  less: { glyph: "#", color: "#2a4d80" },
  styl: { glyph: "#", color: "#a64a4a" },
  vue: { glyph: "vu", color: "#41b883" },
  svelte: { glyph: "sv", color: "#ff3e00" },
  astro: { glyph: "as", color: "#ff5d01" },
  php: { glyph: "ph", color: "#777bb4" },
  py: { glyph: "py", color: "#3776ab" },
  pyi: { glyph: "py", color: "#3776ab" },
  rb: { glyph: "rb", color: "#cc342d" },
  pl: { glyph: "pl", color: "#0298c3" },
  pm: { glyph: "pl", color: "#0298c3" },
  lua: { glyph: "lu", color: "#000080" },
  sh: { glyph: "$", color: "#89e051" },
  bash: { glyph: "$", color: "#89e051" },
  zsh: { glyph: "$", color: "#89e051" },
  fish: { glyph: "$", color: "#89e051" },
  ps1: { glyph: "$", color: "#012456" },
  psm1: { glyph: "$", color: "#012456" },
  bat: { glyph: "$", color: "#c5f6ff" },
  cmd: { glyph: "$", color: "#c5f6ff" },
  ahk: { glyph: "ah", color: "#339999" },

  // ── config / data formats ────────────────────────────────────────────
  toml: { glyph: "T", color: "#9c4221" },
  yaml: { glyph: "Y", color: "#cb171e" },
  yml: { glyph: "Y", color: "#cb171e" },
  xml: { glyph: "x", color: "#0060ac" },
  ini: { glyph: "=", color: "#8a8f98" },
  cfg: { glyph: "=", color: "#8a8f98" },
  conf: { glyph: "=", color: "#8a8f98" },
  env: { glyph: "=", color: "#e8c547" },
  editorconfig: { glyph: "=", color: "#8a8f98" },
  gradle: { glyph: "G", color: "#02303a" },
  properties: { glyph: "=", color: "#8a8f98" },

  // ── build / package manifests ───────────────────────────────────────
  lock: { glyph: "L", color: "#8a8f98" },

  // ── docs / text ──────────────────────────────────────────────────────
  md: { glyph: "M", color: "#083fa1" },
  markdown: { glyph: "M", color: "#083fa1" },
  mdx: { glyph: "M", color: "#083fa1" },
  rst: { glyph: "M", color: "#141414" },
  txt: { glyph: "¶", color: "#8a8f98" },
  log: { glyph: "¶", color: "#8a8f98" },
  pdf: { glyph: "P", color: "#e53935" },

  // ── shell-relevant ──────────────────────────────────────────────────
  exe: { glyph: "•", color: "#5fa8e0" },
  msi: { glyph: "•", color: "#5fa8e0" },
  vbs: { glyph: "•", color: "#5fa8e0" },
  com: { glyph: "•", color: "#5fa8e0" },
  scr: { glyph: "•", color: "#5fa8e0" },

  // ── images / media ──────────────────────────────────────────────────
  png: { glyph: "img", color: "#a371f7" },
  jpg: { glyph: "img", color: "#a371f7" },
  jpeg: { glyph: "img", color: "#a371f7" },
  gif: { glyph: "img", color: "#a371f7" },
  bmp: { glyph: "img", color: "#a371f7" },
  webp: { glyph: "img", color: "#a371f7" },
  ico: { glyph: "img", color: "#a371f7" },
  svg: { glyph: "img", color: "#ffb13b" },
  mp4: { glyph: "mov", color: "#fd7e14" },
  mkv: { glyph: "mov", color: "#fd7e14" },
  webm: { glyph: "mov", color: "#fd7e14" },
  mov: { glyph: "mov", color: "#fd7e14" },
  avi: { glyph: "mov", color: "#fd7e14" },
  mp3: { glyph: "snd", color: "#ff5d8f" },
  wav: { glyph: "snd", color: "#ff5d8f" },
  flac: { glyph: "snd", color: "#ff5d8f" },
  ogg: { glyph: "snd", color: "#ff5d8f" },

  // ── archives ──────────────────────────────────────────────────────────
  zip: { glyph: "z", color: "#d97706" },
  tar: { glyph: "z", color: "#d97706" },
  gz: { glyph: "z", color: "#d97706" },
  bz2: { glyph: "z", color: "#d97706" },
  xz: { glyph: "z", color: "#d97706" },
  "7z": { glyph: "z", color: "#d97706" },
  rar: { glyph: "z", color: "#d97706" },
};

const NAME_GLYPH: Record<string, FileGlyph> = {
  // special files
  ".gitignore": { glyph: "g", color: "#f1502f" },
  ".gitattributes": { glyph: "g", color: "#f1502f" },
  ".gitmodules": { glyph: "g", color: "#f1502f" },
  ".gitconfig": { glyph: "g", color: "#f1502f" },
  ".gitkeep": { glyph: "g", color: "#f1502f" },
  ".editorconfig": { glyph: "=", color: "#8a8f98" },
  ".env": { glyph: "=", color: "#e8c547" },
  ".env.local": { glyph: "=", color: "#e8c547" },
  ".env.production": { glyph: "=", color: "#e8c547" },
  ".env.development": { glyph: "=", color: "#e8c547" },
  "license": { glyph: "©", color: "#d4ac0d" },
  "license.md": { glyph: "©", color: "#d4ac0d" },
  "license.txt": { glyph: "©", color: "#d4ac0d" },
  "licenses.md": { glyph: "©", color: "#d4ac0d" },
  "copying": { glyph: "©", color: "#d4ac0d" },
  "copying.txt": { glyph: "©", color: "#d4ac0d" },
  "readme": { glyph: "M", color: "#083fa1" },
  "readme.md": { glyph: "M", color: "#083fa1" },
  "readme.txt": { glyph: "M", color: "#083fa1" },
  "changelog": { glyph: "M", color: "#083fa1" },
  "changelog.md": { glyph: "M", color: "#083fa1" },
  "todo": { glyph: "M", color: "#083fa1" },
  "todo.md": { glyph: "M", color: "#083fa1" },
  "contributing": { glyph: "M", color: "#083fa1" },
  "contributing.md": { glyph: "M", color: "#083fa1" },
  "authors": { glyph: "M", color: "#083fa1" },
  "authors.md": { glyph: "M", color: "#083fa1" },
  "makefile": { glyph: "M", color: "#427819" },
  "gnumakefile": { glyph: "M", color: "#427819" },
  "cmakelists.txt": { glyph: "M", color: "#064f8c" },
  "dockerfile": { glyph: "D", color: "#2496ed" },
  ".dockerignore": { glyph: "D", color: "#2496ed" },
  "docker-compose.yml": { glyph: "D", color: "#2496ed" },
  "docker-compose.yaml": { glyph: "D", color: "#2496ed" },
  "docker-compose.override.yml": { glyph: "D", color: "#2496ed" },
  "docker-compose.override.yaml": { glyph: "D", color: "#2496ed" },
  "package.json": { glyph: "{}", color: "#cb3837" },
  "package-lock.json": { glyph: "L", color: "#cb3837" },
  "pnpm-lock.yaml": { glyph: "L", color: "#f69ad4" },
  "yarn.lock": { glyph: "L", color: "#2c8ebb" },
  "cargo.toml": { glyph: "T", color: "#dea584" },
  "cargo.lock": { glyph: "L", color: "#dea584" },
  "go.mod": { glyph: "go", color: "#00add8" },
  "go.sum": { glyph: "L", color: "#00add8" },
  "gemfile": { glyph: "rb", color: "#cc342d" },
  "gemfile.lock": { glyph: "L", color: "#cc342d" },
  "requirements.txt": { glyph: "py", color: "#3776ab" },
  "setup.py": { glyph: "py", color: "#3776ab" },
  "pyproject.toml": { glyph: "T", color: "#3776ab" },
  "tsconfig.json": { glyph: "ts", color: "#3178c6" },
  "jsconfig.json": { glyph: "js", color: "#f7df1e" },
  "vite.config.ts": { glyph: "vi", color: "#bd34fe" },
  "vite.config.js": { glyph: "vi", color: "#bd34fe" },
  "next.config.js": { glyph: "nx", color: "#000000" },
  "next.config.mjs": { glyph: "nx", color: "#000000" },
  "svelte.config.js": { glyph: "sv", color: "#ff3e00" },
  "nuxt.config.ts": { glyph: "nx", color: "#00dc82" },
  "astro.config.mjs": { glyph: "as", color: "#ff5d01" },
  ".npmrc": { glyph: "=", color: "#cb3837" },
  ".nvmrc": { glyph: "=", color: "#cb3837" },
  ".rustfmt.toml": { glyph: "=", color: "#dea584" },
  "rust-toolchain.toml": { glyph: "=", color: "#dea584" },
  "rust-toolchain": { glyph: "=", color: "#dea584" },
  ".prettierrc": { glyph: "=", color: "#a371f7" },
  ".prettierrc.json": { glyph: "=", color: "#a371f7" },
  ".prettierrc.yaml": { glyph: "=", color: "#a371f7" },
  ".prettierrc.yml": { glyph: "=", color: "#a371f7" },
  ".eslintrc": { glyph: "=", color: "#4b32c3" },
  ".eslintrc.json": { glyph: "=", color: "#4b32c3" },
  ".eslintrc.yml": { glyph: "=", color: "#4b32c3" },
  ".eslintrc.yaml": { glyph: "=", color: "#4b32c3" },
  "eslint.config.js": { glyph: "=", color: "#4b32c3" },
  "eslint.config.mjs": { glyph: "=", color: "#4b32c3" },
  "eslint.config.ts": { glyph: "=", color: "#4b32c3" },
  ".gitlab-ci.yml": { glyph: "ci", color: "#fc6d26" },
  ".github": { glyph: "ci", color: "#fc6d26" },
  "renovate.json": { glyph: "{}", color: "#1d9bf0" },
  "renovate.json5": { glyph: "{}", color: "#1d9bf0" },
  ".claude": { glyph: "AI", color: "#d97757" },
  "claude.md": { glyph: "AI", color: "#d97757" },
  ".cursorrules": { glyph: "AI", color: "#d97757" },
  "copilot-instructions.md": { glyph: "AI", color: "#d97757" },
  "agents.md": { glyph: "AI", color: "#d97757" },
};

/**
 * Resolve the (glyph, color) for an arbitrary file name.
 * Special filenames take precedence; otherwise the last extension is used.
 */
export function glyphForFile(name: string): FileGlyph {
  const lower = name.toLowerCase();
  if (NAME_GLYPH[lower]) return NAME_GLYPH[lower];
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return DEFAULT_GLYPH; // hidden files w/o ext, or no ext
  const ext = lower.slice(dot + 1);
  return EXT_GLYPH[ext] ?? DEFAULT_GLYPH;
}