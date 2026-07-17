#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distRoot = resolve(__dirname, "..", "dist");

if (!existsSync(distRoot)) {
	console.error(`[bundle-isolation] dist not found: ${distRoot}`);
	process.exit(1);
}

const IMPORT_RE = /(?:from|require|import)\s*\(?\s*["']([^"']+)["']/g;

function* walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const s = statSync(full);
		if (s.isDirectory()) {
			yield* walk(full);
		} else if (/\.(js|cjs|mjs)$/.test(entry)) {
			yield full;
		}
	}
}

function collectImports(file) {
	const src = readFileSync(file, "utf8");
	const out = [];
	for (const m of src.matchAll(IMPORT_RE)) out.push(m[1]);
	return out;
}

function resolveLocal(specifier, fromFile) {
	if (!specifier.startsWith(".")) return null;
	const baseDir = dirname(fromFile);
	const candidates = [
		resolve(baseDir, specifier),
		resolve(baseDir, `${specifier}.js`),
		resolve(baseDir, `${specifier}.cjs`),
		resolve(baseDir, `${specifier}.mjs`),
		resolve(baseDir, specifier, "index.js"),
		resolve(baseDir, specifier, "index.cjs"),
	];
	for (const c of candidates) {
		if (existsSync(c) && statSync(c).isFile()) return c;
	}
	return null;
}

function transitiveExternals(entry) {
	const seen = new Set();
	const externals = new Set();
	const queue = [entry];
	while (queue.length) {
		const file = queue.shift();
		if (seen.has(file)) continue;
		seen.add(file);
		for (const spec of collectImports(file)) {
			if (spec.startsWith(".")) {
				const next = resolveLocal(spec, file);
				if (next) queue.push(next);
			} else {
				externals.add(spec);
			}
		}
	}
	return externals;
}

function checkSubpath(subpath, forbidden) {
	const dir = join(distRoot, subpath);
	if (!existsSync(dir)) {
		console.warn(`[bundle-isolation] WARN: ${subpath} not built yet`);
		return [];
	}
	const errs = [];
	for (const file of walk(dir)) {
		const externals = transitiveExternals(file);
		for (const f of forbidden) {
			if (externals.has(f)) {
				errs.push(`${file} transitively imports ${f}`);
			}
		}
	}
	return errs;
}

function checkRoot(forbidden) {
	const errs = [];
	for (const entry of readdirSync(distRoot)) {
		const full = join(distRoot, entry);
		if (statSync(full).isFile() && /\.(js|cjs|mjs)$/.test(entry)) {
			const externals = transitiveExternals(full);
			for (const f of forbidden) {
				if (externals.has(f)) {
					errs.push(`${full} transitively imports ${f}`);
				}
			}
		}
	}
	return errs;
}

const errors = [
	...checkSubpath("tanstack-form", ["react-hook-form"]),
	...checkSubpath("react-hook-form", ["@tanstack/react-form"]),
	...checkRoot(["react-hook-form", "@tanstack/react-form"]),
];

if (errors.length > 0) {
	console.error("[bundle-isolation] FAIL:");
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}
console.log("[bundle-isolation] OK");
