import { execFileSync } from "node:child_process";
import { isolatedGitEnv } from "../scripts/lib/git-env.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Deterministic PRNG so any failing generated case can be reproduced from its seed. */
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a += 0x6d2b79f5;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const between = (r, lo, hi) => lo + r() * (hi - lo);
export const int = (r, lo, hi) => Math.floor(between(r, lo, hi + 1));

export function tmpDir(prefix = "banana-test-") {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function hasKicad() {
	try {
		execFileSync("kicad-cli", ["--version"], {
			stdio: "ignore",
			timeout: 15000,
		});
		return true;
	} catch {
		return process.env.KICAD_CLI_PATH
			? fs.existsSync(process.env.KICAD_CLI_PATH)
			: false;
	}
}

export function git(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: isolatedGitEnv(),
	});
}

export function makeRepo(files, message = "c1") {
	const dir = tmpDir("banana-repo-");
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "t@example.invalid");
	git(dir, "config", "user.name", "t");
	git(dir, "config", "commit.gpgsign", "false");
	commit(dir, files, message);
	return dir;
}

export function commit(dir, files, message) {
	for (const [name, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		fs.writeFileSync(path.join(dir, name), content);
	}
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", message);
	return git(dir, "rev-parse", "HEAD").trim();
}
