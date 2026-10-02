// Isolated backend observer benchmark. Compiles the actual production detector,
// without building Tauri or including PTY/IPC/xterm/rendering in the measurement.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Optional revision allows before/after measurements without switching branches
// or changing any tracked files: `node scripts/bench-pty-pipeline.mjs HEAD`.
const revision = process.argv[2];
let pty;
if (revision) {
	const source = spawnSync(
		"git",
		["show", `${revision}:src-tauri/src/pty.rs`],
		{
			cwd: root,
			encoding: "utf8",
		},
	);
	if (source.error) throw source.error;
	if (source.status !== 0) throw new Error(source.stderr);
	pty = source.stdout;
} else {
	pty = await readFile(path.join(root, "src-tauri/src/pty.rs"), "utf8");
}
const start = pty.indexOf("struct AltScreenDetector {");
const end = pty.indexOf("/// Length of the OSC terminator", start);
if (start < 0 || end < 0)
	throw new Error("PTY detector source boundaries missing");
const detector = pty.slice(start, end);
const temp = await mkdtemp(
	path.join(
		process.env.PARTTY_BENCH_TEMP_DIR ?? os.tmpdir(),
		"partty-pty-bench-",
	),
);

try {
	await writeFile(
		path.join(temp, "Cargo.toml"),
		`[package]
name = "partty-pty-pipeline-bench"
version = "0.0.0"
edition = "2024"
[dependencies]
memchr = "2"
[[bin]]
name = "bench"
path = "bench.rs"
[profile.release]
codegen-units = 1
`,
	);
	await writeFile(
		path.join(temp, "bench.rs"),
		`${detector}
use std::hint::black_box;
use std::time::Instant;

fn measure(name: &str, bytes: &[u8]) {
    // Feed 128 MiB per sample, retaining detector state across batches as the
    // emitter does. Fixture allocation and warmup are outside the timed region.
    let iterations = (128 * 1024 * 1024 / bytes.len()).max(1);
    let mut detector = AltScreenDetector::new();
    let mut transitions = Vec::with_capacity(8);
    for _ in 0..32 {
        detector.observe(black_box(bytes), &mut transitions);
        transitions.clear();
    }
    let mut samples = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        for _ in 0..iterations {
            detector.observe(black_box(bytes), &mut transitions);
            black_box(&transitions);
            transitions.clear();
        }
        samples.push(start.elapsed().as_secs_f64());
    }
    samples.sort_by(f64::total_cmp);
    let seconds = samples[2];
    println!("{name}: median {:.3} ms, {:.1} MiB/s", seconds * 1000.0,
        (iterations * bytes.len()) as f64 / (1024.0 * 1024.0) / seconds);
}

fn main() {
    let plain = b"plain log output without control sequences\\r\\n".repeat(3000);
    let sparse = [b"\\x1b[32m".as_slice(), &vec![b'x'; 4096], b"\\x1b[0m\\r\\n"].concat().repeat(32);
    let colored = format!("\\x1b[32m{}\\x1b[0m\\r\\n", "colored log text ".repeat(5)).into_bytes().repeat(1400);
    let tui = b"\\x1b[12;4H\\x1b[38;2;120;80;255mstatus ready\\x1b[0m".repeat(3000);
    measure("plain", &plain);
    measure("sparse ANSI (4 KiB text runs)", &sparse);
    measure("colored logs (80-byte text runs)", &colored);
    measure("dense TUI controls", &tui);
}
`,
	);
	process.stdout.write(
		`Backend alternate-screen observer (${revision ?? "working tree"}) only; five samples, median, 128 MiB/sample.\n`,
	);
	const result = spawnSync(
		"cargo",
		[
			"run",
			"--release",
			"--offline",
			"--manifest-path",
			path.join(temp, "Cargo.toml"),
		],
		{ cwd: root, stdio: "inherit" },
	);
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
} finally {
	await rm(temp, { recursive: true, force: true, maxRetries: 3 });
}
