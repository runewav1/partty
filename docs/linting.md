# Frontend checks

Run `pnpm lint`, `pnpm typecheck`, and `pnpm test:front` before committing frontend
changes. Biome is pinned in `package.json`; keep its configuration schema at the
same version. Do not use an unpinned CLI to rewrite the configuration.

## Rule policy

- Keep the recommended baseline. The existing `correctness: "error"` and
  `performance: "warn"` group settings enable **all** rules in those groups,
  not only recommended rules. Keep those checks, with the exceptions below;
  do not enable every nursery or style rule just to maximize coverage.
- Enable the individual async checks `noFloatingPromises`, `noMisusedPromises`,
  and `useAwaitThenable` at warning level. They are nursery rules in Biome
  2.6.3, so review their behavior when upgrading. A successful lint command is
  not a substitute for typechecking or runtime tests.
- An event source that expects a synchronous callback does not observe a
  returned promise. Start async work explicitly and catch meaningful failures.
  `void` documents intentional fire-and-forget behavior; it does **not** catch
  rejections. Do not add it just to hide a missing error handler.
- Limit style checks to `useConst`, `useImportType`, and
  `useNodejsImportProtocol`. Formatting handles presentation; non-null assertion
  bans and broad style rewrites are not part of this policy.
- Keep secret scanning at its default sensitivity. Suppress individual known
  false positives with an explanation, rather than exempting entire app files.
  This heuristic is not a replacement for repository secret scanning.

## Intentional exceptions

- Generated output, dependencies, the vendored shim, and CSS remain excluded.
  CSS cleanup is a separate task; enabling it here would introduce unrelated
  formatting and `!important` churn.
- Biome 2.6 also formats Markdown and YAML. Project documentation and workspace
  YAML are checked; `pnpm-lock.yaml` is left to pnpm, and Markdown in the vendored
  Rust patches (including licenses) is left untouched.
- Node modules are allowed in Node scripts, build configuration, and tests,
  but remain prohibited in browser application code.
- The Qwik lexical-scope rule is disabled for Node scripts and test fixtures:
  this is not a Qwik project, and it misidentifies fixture callbacks as Qwik
  serializable callbacks. The two default CommonJS imports in the replay test
  have local resolution suppressions because their runtime exports differ from
  their browser-oriented type declarations.
- Empty methods in the production metrics stub are deliberate. Console output
  in `main.ts` includes lifecycle failures and optional diagnostics; other
  modules explain their diagnostic logging locally.
- Sequential awaits in the terminal lifecycle, paced PTY writes, and tests are
  intentional. Preserve order rather than replacing them with `Promise.all` to
  satisfy a performance suggestion. The large orchestration module retains its
  existing await/regex exceptions; smaller modules use local explanations.
- Terminal control-character regexes are necessary for parsing/sanitization.
  Keep their documented suppressions. The boot style in `index.html` also
  intentionally uses `!important`.
- Function-length limits remain disabled. Splitting orchestration functions
  solely to satisfy a line count is not a correctness improvement.

## Formatting and fixes

Biome-managed JS/TS/JSON/HTML files, project Markdown, and workspace YAML use LF,
enforced by `.gitattributes` so Windows Git checkouts do not repeatedly fail
formatting. Shell and PowerShell script line-ending rules remain unchanged.

Prefer `pnpm exec biome format --write <files>` for formatting-only changes.
Review lint fixes individually; do not apply repository-wide `--unsafe` fixes.
After an upgrade, rerun the full checks and review new diagnostics rather than
automatically disabling them or broadening suppressions.
