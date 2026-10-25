#!/usr/bin/env node
/**
 * Builds the downloadable release:
 *   node scripts/make-release.mjs [outDir]            (default: website/downloads)
 * Produces banana-<version>-portable.zip (+ .tar.gz), SHA256SUMS, and ../releases.json
 * (the file the download website reads). The bundle is platform independent.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "../backend/src/runtime-detect.js";
import { TARGETS, NODE_VERSION, extractRuntime, fetchArchive } from "./lib/node-runtime.mjs";
import { zipDirectory } from "./lib/zip.mjs";

const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
const version = process.env.BANANA_VERSION || pkg.version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Bad version: ${version}`);

const withNode = process.argv.includes("--with-node") || process.env.BANANA_WITH_NODE === "1";
const outDir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || path.join(APP_ROOT, "website", "downloads"));
const stage = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || process.env.TMPDIR || "/tmp", "banana-release-"));
const bundle = path.join(stage, `banana-${version}`);

execFileSync(process.execPath, [path.join(APP_ROOT, "scripts", "make-portable.mjs"), bundle], { stdio: "inherit" });

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

const meta = new Map();
const zipName = `banana-${version}-portable.zip`;
meta.set(zipName, { os: "any", arch: "any", label: "Any system (Node.js not included)", bundlesNode: false });
const tgzName = `banana-${version}-portable.tar.gz`;
zipDirectory(bundle, path.join(outDir, zipName), `banana-${version}`);
try {
	execFileSync("tar", ["-czf", path.join(outDir, tgzName), "-C", stage, `banana-${version}`], { stdio: "inherit" });
} catch {
	console.warn("tar not available; skipping .tar.gz");
}

if (withNode) {
	// One zip per platform that already contains Node.js, so the only prerequisites left are KiCad and Git.
	for (const target of TARGETS) {
		const name = `banana-${version}-${target.os}-${target.arch}.zip`;
		const copyDir = path.join(stage, `${target.os}-${target.arch}`, `banana-${version}`);
		fs.cpSync(bundle, copyDir, { recursive: true });
		const runtime = path.join(copyDir, "runtime", target.runtimeDir);
		extractRuntime(await fetchArchive(target), target, runtime);
		zipDirectory(copyDir, path.join(outDir, name), `banana-${version}`);
		meta.set(name, { os: target.os, arch: target.arch, label: target.label, bundlesNode: true, nodeVersion: NODE_VERSION });
		console.log(`  built ${name}`);
	}
}

const files = fs.readdirSync(outDir).sort();
const assets = files.map((name) => ({ name, bytes: fs.statSync(path.join(outDir, name)).size, sha256: sha(path.join(outDir, name)), ...(meta.get(name) || {}) }));
fs.writeFileSync(path.join(outDir, "SHA256SUMS"), `${assets.map((a) => `${a.sha256}  ${a.name}`).join("\n")}\n`);

const manifest = {
	version,
	released: new Date().toISOString().slice(0, 10),
	requires: { node: withNode ? "bundled in platform downloads" : ">=20.11", kicad: ">=7", git: "any recent" },
	assets,
};
fs.writeFileSync(path.join(path.dirname(outDir), "releases.json"), `${JSON.stringify(manifest, null, 2)}\n`);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`\nRelease ${version} written to ${outDir}\n${assets.map((a) => `  ${a.name}  ${(a.bytes / 1048576).toFixed(1)} MiB  ${a.sha256.slice(0, 16)}…`).join("\n")}`);
