import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * @xterm/addon-ligatures bundles `lru-cache`, whose node-ESM build performs a
 * top-level `import { channel, tracingChannel } from "node:diagnostics_channel"`.
 * Vite externalizes that to an empty module, so `channel()` is undefined and the
 * addon throws `(0, e.channel) is not a function` when loaded. lru-cache ships a
 * `browser` condition with a no-op dummy for exactly this case; mirror it here.
 * (see https://github.com/isaacs/node-lru-cache/issues/401)
 */
function diagnosticsChannelBrowserShim(): Plugin {
  const NODE_ID = "node:diagnostics_channel";
  const VIRTUAL_ID = "\0virtual:node:diagnostics_channel-browser-shim";
  return {
    name: "diagnostics-channel-browser-shim",
    enforce: "pre",
    resolveId(id) {
      if (id === NODE_ID) return VIRTUAL_ID;
    },
    load(id) {
      if (id !== VIRTUAL_ID) return;
      return `
const dummy = { hasSubscribers: false };
export function channel() { return dummy; }
export function tracingChannel() { return dummy; }
`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [diagnosticsChannelBrowserShim()],

  resolve: {
    alias:
      mode === "production"
        ? {
            [path.resolve(__dirname, "src/perf.ts")]: path.resolve(
              __dirname,
              "src/perf.stub.ts",
            ),
          }
        : {},
  },

  build: {
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
