#!/usr/bin/env node
/**
 * Builds a self-contained folder to copy onto a USB stick:
 *   node scripts/make-portable.mjs [outDir]      (default: dist-portable/banana)
 * It contains the built UI, the server, production-only (pure JavaScript) dependencies,
 * launchers, the licence, and a SHA-256 manifest that preflight verifies on every start.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "../backend/src/runtime-detect.js";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const out = path.resolve(
	process.argv[2] || path.join(APP_ROOT, "dist-portable", "banana"),
);
const run = (cmd, args, cwd) =>
	execFileSync(cmd, args, {
		cwd,
		stdio: "inherit",
		shell: process.platform === "win32",
	});

function copy(rel, { optional = false } = {}) {
	const from = path.join(APP_ROOT, rel);
	if (!fs.existsSync(from)) {
		if (optional) return;
		throw new Error(`missing ${rel}`);
	}
	fs.cpSync(from, path.join(out, rel), {
		recursive: true,
		filter: (src) => !/node_modules|temp_storage|\.banana/.test(src),
	});
}

function listFiles(dir, base = dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const full = path.join(dir, e.name);
		return e.isDirectory()
			? listFiles(full, base)
			: [path.relative(base, full).split(path.sep).join("/")];
	});
}

if (
	out === APP_ROOT ||
	out.startsWith(`${APP_ROOT}${path.sep}backend`) ||
	out.startsWith(`${APP_ROOT}${path.sep}frontend`)
) {
	throw new Error("Refusing to use that output directory");
}

console.log("Building UI...");
run(npm, ["run", "build", "--workspace=frontend"], APP_ROOT);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const rel of [
	"backend/src",
	"backend/package.json",
	"frontend/dist",
	"frontend/package.json",
	"scripts",
	"samples",
	"package.json",
	"package-lock.json",
	"start.sh",
	"start.bat",
])
	copy(rel);
for (const rel of [
	"LICENSE",
	"NOTICE.md",
	"README.md",
	".env.example",
	"deploy",
])
	copy(rel, { optional: true });
fs.rmSync(path.join(out, "backend", "src", "types.d.ts"), { force: true });
fs.mkdirSync(path.join(out, "runtime"), { recursive: true });
fs.writeFileSync(
	path.join(out, "runtime", "README.txt"),
	"Optional: drop a portable Node.js into runtime/node-<os>-<arch>/ (e.g. node-win32-x64, node-linux-arm64)\nand/or a KiCad install into runtime/kicad*/ so the stick needs nothing installed on the target computer.\nKiCad is GPL software with its own licence; see NOTICE.md.\n",
);
try {
	fs.chmodSync(path.join(out, "start.sh"), 0o755);
} catch {
	/* FAT/exFAT sticks have no unix modes; start.sh can be run with `sh start.sh` */
}

console.log("Installing production dependencies...");
run(npm, ["ci", "--workspace=backend", "--omit=dev", "--ignore-scripts"], out);

const nativeAddons = listFiles(path.join(out, "node_modules")).filter((f) =>
	f.endsWith(".node"),
);
if (nativeAddons.length > 0) {
	throw new Error(
		`Bundle is no longer platform independent; native add-ons found: ${nativeAddons.slice(0, 3).join(", ")}`,
	);
}

const lines = [];
for (const rel of listFiles(out).sort()) {
	if (
		rel === "MANIFEST.sha256" ||
		rel.startsWith("node_modules/") ||
		rel.startsWith("runtime/")
	)
		continue;
	lines.push(
		`${crypto
			.createHash("sha256")
			.update(fs.readFileSync(path.join(out, rel)))
			.digest("hex")} *${rel}`,
	);
}
fs.writeFileSync(path.join(out, "MANIFEST.sha256"), `${lines.join("\n")}\n`);

console.log(
	`\nPortable bundle ready: ${out}\nCopy this folder to the USB stick, then run start.sh (Linux/macOS) or start.bat (Windows).`,
);
