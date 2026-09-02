/**
 * Browser shim for `node:diagnostics_channel`.
 *
 * @xterm/addon-ligatures bundles `lru-cache`, whose node-ESM build performs a
 * top-level `import { channel, tracingChannel } from "node:diagnostics_channel"`.
 * In the browser this module doesn't exist; Vite externalizes it to an empty
 * module, so `channel()` is undefined and the addon throws
 * `(0, e.channel) is not a function` at load time. lru-cache ships a `browser`
 * condition with a no-op dummy for exactly this case — mirror it here.
 * (see https://github.com/isaacs/node-lru-cache/issues/401)
 */

const dummy = { hasSubscribers: false };

export function channel(): unknown {
  return dummy;
}

export function tracingChannel(): unknown {
  return dummy;
}