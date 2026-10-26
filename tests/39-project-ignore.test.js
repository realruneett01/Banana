// KiCad writes per-user files (e.g. fab.kicad_prl from KiCad 10) next to the board: they must never show up as
// design changes, including in projects created before the rule existed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { tmpDir } from "./helpers.js";

const projects = tmpDir("banana-ignore-");
process.env.BANANA_PROJECTS_DIR = projects;
const P = await import("../backend/src/design/project.js");
after(() => fs.rmSync(projects, { recursive: true, force: true }));

const status = (dir) =>
	execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });

test("new projects ignore *.kicad_prl and the other local KiCad files", async () => {
	await P.createProject("fresh");
	const dir = P.projectDir("fresh");
	const ign = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
	for (const l of ["results/", "*.bak", "*-backups/", "fp-info-cache", "*.kicad_prl"])
		assert.ok(ign.split("\n").includes(l), l);
	fs.writeFileSync(path.join(dir, "fresh.kicad_prl"), "{}");
	assert.equal(status(dir), "");
});

test("older projects get the rule added on their next build, once", async () => {
	await P.createProject("old");
	const dir = P.projectDir("old");
	fs.writeFileSync(path.join(dir, ".gitignore"), "results/\n*.bak"); // no trailing newline, no prl rule
	execFileSync("git", ["add", "-A"], { cwd: dir });
	execFileSync(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "old ignore"],
		{ cwd: dir },
	);
	await P.build("old", "first");
	const once = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
	assert.ok(once.split("\n").includes("*.kicad_prl"));
	assert.equal(once.split("\n").filter((l) => l === "results/").length, 1);
	fs.writeFileSync(path.join(dir, "old.kicad_prl"), "{}");
	await P.build("old", "second");
	assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), once);
	assert.equal(status(dir), "");
});
