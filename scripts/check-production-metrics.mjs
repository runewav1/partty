import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const assets = new URL("../dist/assets/", import.meta.url);
const files = (await readdir(assets)).filter((name) => name.endsWith(".js"));
assert.ok(files.length > 0, "Build the production app before checking metrics isolation");
for (const file of files) {
	const source = await readFile(new URL(file, assets), "utf8");
	for (const marker of ["__parttyPerf", "write.latency.ms", "partty-dev-metrics-", "observer.longtask"]) {
		assert.ok(!source.includes(marker), `Dev metrics marker ${marker} leaked into ${file}`);
	}
}
console.log(`Production metrics isolation passed (${files.length} JavaScript assets checked).`);
