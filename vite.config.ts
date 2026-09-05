import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite exposes its development host through the process environment.
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
const config = defineConfig(({ mode }) => {
	const aliases: Record<string, string> = {
		// @xterm/addon-ligatures bundles `lru-cache`, whose node-ESM build
		// performs a top-level `import { channel, tracingChannel } from
		// "node:diagnostics_channel"`. In the browser that module is externalized
		// to an empty shim, so `channel()` is undefined and the addon throws
		// `(0, e.channel) is not a function` at load time. Alias it to a no-op
		// dummy (lru-cache's own `browser` condition does the same).
		// (see https://github.com/isaacs/node-lru-cache/issues/401)
		"node:diagnostics_channel": path.resolve(
			__dirname,
			"src/vendor/diagnosticsChannelShim.ts",
		),
	};

	if (mode === "production") {
		aliases[path.resolve(__dirname, "src/pty/perf.ts")] = path.resolve(
			__dirname,
			"src/pty/perf.stub.ts",
		);
	}

	let hmr: { protocol: "ws"; host: string; port: number } | undefined;
	if (host) {
		hmr = {
			protocol: "ws",
			host,
			port: 1421,
		};
	}

	return {
		resolve: {
			alias: aliases,
		},

		optimizeDeps: {
			// The ligatures addon must be served through the normal transform pipeline
			// so the alias above (and any plugin rewriting) applies; pre-bundling it
			// would externalize `node:diagnostics_channel` before the alias resolves.
			exclude: ["@xterm/addon-ligatures"],
		},

		build: {},

		// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
		//
		// 1. prevent Vite from obscuring rust errors
		clearScreen: false,
		// 2. tauri expects a fixed port, fail if that port is not available
		server: {
			port: 1420,
			strictPort: true,
			host,
			hmr,
			watch: {
				// 3. tell Vite to ignore watching `src-tauri`
				ignored: ["**/src-tauri/**"],
			},
		},
	};
});

// Vite discovers configuration through the default export.
export default config;
