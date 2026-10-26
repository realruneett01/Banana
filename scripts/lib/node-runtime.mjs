// Fetches an official Node.js build, verifies it against nodejs.org's SHA256SUMS, and extracts just the
// executable (+ licence) into a bundle's runtime/node-<os>-<arch>/ folder, where the launchers look for it.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NODE_VERSION = process.env.BANANA_NODE_VERSION || "22.22.0";

/** Banana platform name -> Node.js download name. */
export const TARGETS = [
	{
		os: "windows",
		arch: "x64",
		label: "Windows (64-bit)",
		runtimeDir: "node-win32-x64",
		archive: "win-x64.zip",
		exe: "node.exe",
	},
	{
		os: "windows",
		arch: "arm64",
		label: "Windows on ARM",
		runtimeDir: "node-win32-arm64",
		archive: "win-arm64.zip",
		exe: "node.exe",
	},
	{
		os: "macos",
		arch: "arm64",
		label: "macOS (Apple silicon)",
		runtimeDir: "node-darwin-arm64",
		archive: "darwin-arm64.tar.gz",
		exe: "bin/node",
	},
	{
		os: "macos",
		arch: "x64",
		label: "macOS (Intel)",
		runtimeDir: "node-darwin-x64",
		archive: "darwin-x64.tar.gz",
		exe: "bin/node",
	},
	{
		os: "linux",
		arch: "x64",
		label: "Linux (x64)",
		runtimeDir: "node-linux-x64",
		archive: "linux-x64.tar.xz",
		exe: "bin/node",
	},
	{
		os: "linux",
		arch: "arm64",
		label: "Linux (ARM64)",
		runtimeDir: "node-linux-arm64",
		archive: "linux-arm64.tar.xz",
		exe: "bin/node",
	},
];

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function download(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

export function parseShasums(text) {
	const map = new Map();
	for (const line of text.split(/\r?\n/)) {
		const m = line.match(/^([0-9a-f]{64})\s+(\S+)$/);
		if (m) map.set(m[2], m[1]);
	}
	return map;
}

let shasumsPromise;
async function shasums() {
	shasumsPromise ||= download(
		`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`,
	).then((b) => parseShasums(b.toString("utf8")));
	return shasumsPromise;
}

/** Downloads (cached) and verifies the archive; throws on any checksum mismatch. */
export async function fetchArchive(target) {
	const name = `node-v${NODE_VERSION}-${target.archive}`;
	const cacheDir = path.join(os.tmpdir(), "banana-node-cache");
	fs.mkdirSync(cacheDir, { recursive: true });
	const file = path.join(cacheDir, name);
	const expected = (await shasums()).get(name);
	if (!expected) throw new Error(`No published checksum for ${name}`);
	if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === expected)
		return file;
	const buf = await download(
		`https://nodejs.org/dist/v${NODE_VERSION}/${name}`,
	);
	if (sha256(buf) !== expected)
		throw new Error(`Checksum mismatch for ${name}; refusing to use it`);
	fs.writeFileSync(file, buf);
	return file;
}

/** Extracts the executable and licence from a verified archive into destDir. */
export function extractRuntime(archiveFile, target, destDir) {
	const top = `node-v${NODE_VERSION}-${target.archive.replace(/\.(zip|tar\.gz|tar\.xz)$/, "")}`;
	fs.mkdirSync(path.join(destDir, path.dirname(target.exe)), {
		recursive: true,
	});
	const exePath = path.join(destDir, target.exe);
	const licensePath = path.join(destDir, "LICENSE-nodejs.txt");
	if (target.archive.endsWith(".zip")) {
		const out = (member) =>
			execFileSync("unzip", ["-p", archiveFile, `${top}/${member}`], {
				maxBuffer: 512 * 1024 * 1024,
			});
		fs.writeFileSync(exePath, out(target.exe));
		fs.writeFileSync(licensePath, out("LICENSE"));
	} else {
		const flag = target.archive.endsWith(".xz") ? "-xJf" : "-xzf";
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "banana-node-x-"));
		try {
			execFileSync("tar", [
				flag,
				archiveFile,
				"-C",
				tmp,
				`${top}/${target.exe}`,
				`${top}/LICENSE`,
			]);
			fs.copyFileSync(path.join(tmp, top, target.exe), exePath);
			fs.copyFileSync(path.join(tmp, top, "LICENSE"), licensePath);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	}
	if (!target.exe.endsWith(".exe")) fs.chmodSync(exePath, 0o755);
	return exePath;
}
