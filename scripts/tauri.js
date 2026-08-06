import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const isDev = args[0] === "dev";
const full = isDev
  ? [args[0], "--config", "src-tauri/tauri.dev.conf.json", ...args.slice(1)]
  : args;

const cliJs = path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const result = spawnSync(process.execPath, [cliJs, ...full], { stdio: "inherit" });
process.exit(result.status ?? (result.error ? 1 : 0));
