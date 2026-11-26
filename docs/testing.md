# Frontend tests

Run the suite with `pnpm run test:front`.

- Organize tests around a behavior and its owner, not around individual fixes. When changing behavior, update or extend its existing scenario first.
- Use one scenario for a sequence users or callers actually exercise, such as opening, refreshing, and running a palette command. Keep distinct failure modes separate when combining them would make failures harder to diagnose.
- Assert visible results or public contracts. Assert implementation details only when they are themselves a requirement—for example, retaining DOM nodes during idle refresh or handing off a byte chunk without copying.
- Reuse the VM and DOM fixtures in `src/tests/support/` when appropriate. Prefer direct imports for pure modules and mock at the browser or IPC boundary.
- Before removing a test, identify which remaining scenario covers its meaningful assertions. Fewer test names alone aren't evidence of better coverage.
