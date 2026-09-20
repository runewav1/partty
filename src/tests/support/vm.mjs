/**
 * Shared VM module loader for tests that exercise TypeScript sources directly.
 *
 * Each loader owns its globals and module cache. Relative imports may omit
 * `.ts`; stubs use absolute paths or bare package names and contain either
 * module source or an object of exports. Only linking is queued: evaluation
 * stays independent so top-level await can dynamically import another module.
 */

import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const EXTENSIONED = /\.[cm]?[jt]s$/;

function toPath(value) {
	return value instanceof URL ? fileURLToPath(value) : value;
}

function resolveKey(specifier, parent) {
	if (!specifier.startsWith(".")) return specifier;
	const base = resolve(dirname(parent), specifier);
	return EXTENSIONED.test(base) ? base : `${base}.ts`;
}

export function createVmLoader({ root, globals = {}, stubs = {} }) {
	const rootPath = toPath(root);
	const context = createContext(globals);
	/** key -> Promise<Module> (cached before any async work). */
	const modules = new Map();
	let linkQueue = Promise.resolve();
	/** Module -> Promise<Module> (evaluate phase, once per module). */
	const ready = new Map();
	const stubFor = (key) => (stubs instanceof Map ? stubs.get(key) : stubs[key]);

	const dynamicImporter = (specifier, ref) =>
		linkAndEvaluate(load(specifier, ref.identifier));

	async function instantiate(key) {
		const stub = stubFor(key);
		if (typeof stub === "string") {
			return new SourceTextModule(stub, {
				context,
				identifier: key,
				importModuleDynamically: dynamicImporter,
			});
		}
		if (stub && typeof stub === "object") {
			return new SyntheticModule(
				Object.keys(stub),
				function () {
					for (const [name, value] of Object.entries(stub)) {
						this.setExport(name, value);
					}
				},
				{ context, identifier: key },
			);
		}
		const raw = await readFile(key, "utf8");
		const source = stripTypeScriptTypes(raw, { mode: "transform" });
		return new SourceTextModule(source, {
			context,
			identifier: key,
			importModuleDynamically: dynamicImporter,
		});
	}

	/** Resolve, instantiate (once), and return the module as a promise. */
	function load(specifier, parent) {
		const key = resolveKey(specifier, parent);
		let promise = modules.get(key);
		if (!promise) {
			promise = instantiate(key);
			modules.set(key, promise);
		}
		return promise;
	}

	function linkModule(mod) {
		const linked = linkQueue.then(async () => {
			if (mod.status === "unlinked") await mod.link(link);
		});
		// A failed graph must not prevent unrelated modules from being imported.
		linkQueue = linked.catch(() => undefined);
		return linked;
	}

	/** Link + await evaluation exactly once per module (TLA-safe, error-caching). */
	function linkAndEvaluate(modulePromise) {
		return Promise.resolve(modulePromise).then((mod) => {
			let promise = ready.get(mod);
			if (!promise) {
				promise = (async () => {
					await linkModule(mod);
					// Never skip based on status: an async module reports
					// "evaluated" while its top-level await is pending, and
					// evaluate() returns the promise that settles when done.
					await mod.evaluate();
					return mod;
				})();
				ready.set(mod, promise);
			}
			return promise;
		});
	}

	// Let Node traverse the graph, including static cycles; recursively awaiting
	// each dependency's link here would deadlock when a cycle reaches its parent.
	const link = (specifier, ref) => load(specifier, ref.identifier);

	/** Import a module by path relative to `root` and return its namespace. */
	async function api(path) {
		const mod = await linkAndEvaluate(load(resolve(rootPath, path)));
		return mod.namespace;
	}

	return { context, api };
}
