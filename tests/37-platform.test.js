// Things that only break on some platforms or library versions.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { test } from "node:test";
import { emptyGitConfigPath, isolatedGitEnv } from "../scripts/lib/git-env.mjs";
import { tmpDir } from "./helpers.js";

test("git ignores user and system configuration through a path git accepts on every OS", () => {
	const none = emptyGitConfigPath();
	if (os.platform() === "win32") {
		assert.ok(fs.existsSync(none), "Windows gets a real empty file");
		assert.notEqual(
			none,
			os.devNull,
			"\\\\.\\nul is rejected by Git for Windows",
		);
	}
	const env = isolatedGitEnv({ PATH: process.env.PATH, KEEP: "1" });
	assert.equal(env.KEEP, "1");
	assert.equal(env.GIT_CONFIG_GLOBAL, none);
	assert.equal(env.GIT_CONFIG_SYSTEM, none);
	const dir = tmpDir("banana-gitenv-");
	execFileSync("git", ["init", "-q"], { cwd: dir, env, stdio: "pipe" });
	assert.ok(fs.existsSync(`${dir}/.git`));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("power symbols are recognised in both library spellings", async () => {
	const { isPowerSymbolText } = await import(
		"../backend/src/design/kicad-lib.js"
	);
	for (const head of [
		'(symbol "GND" (power) (pin_names',
		'(symbol "GND" (power global) (pin_names',
		'(symbol "VCC"\n  (power local)\n  (pin_names',
	])
		assert.equal(isPowerSymbolText(head), true, head);
	for (const head of [
		'(symbol "R" (pin_numbers hide)',
		'(symbol "Power_Thing" (property "Description" "(power)ful")',
		'(symbol "X" (powerful))',
	])
		assert.equal(
			isPowerSymbolText(head.replace(/\(power\)ful/, "x")),
			false,
			head,
		);
});
