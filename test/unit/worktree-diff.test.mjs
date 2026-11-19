import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { extractWorkingTreeFile } from "../../backend/src/git-extractor.js";
import { validateDiffGuards } from "../../backend/src/routes/diff-routes.js";

function createTempGitRepo(tempDirs) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "banana-wt-test-"));
	tempDirs.push(dir);
	execFileSync("git", ["init", dir]);
	const schFile = path.join(dir, "board.kicad_sch");
	fs.writeFileSync(schFile, "(kicad_sch (version 20231120) (init true))");
	execFileSync("git", ["-C", dir, "add", "board.kicad_sch"]);
	execFileSync("git", [
		"-C",
		dir,
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-m",
		"init",
	]);
	return { dir, schFile };
}

function cleanupResources(tempDirs, cleanFiles) {
	for (const target of [...cleanFiles, ...tempDirs]) {
		try {
			fs.rmSync(target, { recursive: true, force: true });
		} catch (err) {
			console.warn(
				`worktree-diff test cleanup failed for ${target}: ${err.message}`,
			);
		}
	}
}

describe("worktree diff unit tests", () => {
	const tempDirs = [];
	const cleanFiles = [];
	let repoDir = "";
	let schFile = "";

	before(() => {
		const repo = createTempGitRepo(tempDirs);
		repoDir = repo.dir;
		schFile = repo.schFile;
	});

	after(() => {
		cleanupResources(tempDirs, cleanFiles);
	});

	async function writeAndExtract(content) {
		fs.writeFileSync(schFile, content);
		const outPath = await extractWorkingTreeFile(
			repoDir,
			"board.kicad_sch",
			"wt_test_target.kicad_sch",
		);
		assert.equal(fs.readFileSync(outPath, "utf8"), content);
		return outPath;
	}

	test("extractWorkingTreeFile copies modified content without caching", async () => {
		const outPath1 = await writeAndExtract(
			"(kicad_sch (version 20231120) (comment modified_1))",
		);
		cleanFiles.push(outPath1);
		const outPath2 = await writeAndExtract(
			"(kicad_sch (version 20231120) (comment modified_2))",
		);
		assert.equal(outPath2, outPath1);
	});

	test("extractWorkingTreeFile throws on path escape", async () => {
		await assert.rejects(
			extractWorkingTreeFile(
				repoDir,
				"../outside.kicad_sch",
				"target_esc.kicad_sch",
			),
			/Working tree file not available/,
		);
	});

	test("extractWorkingTreeFile throws on wrong extension", async () => {
		const txtPath = path.join(repoDir, "notes.txt");
		fs.writeFileSync(txtPath, "some notes");
		await assert.rejects(
			extractWorkingTreeFile(repoDir, "notes.txt", "target_notes.txt"),
			/Working tree file not available/,
		);
	});

	const guard = (desc, baseCommit, targetCommit, expected) => ({
		desc,
		params: { baseCommit, targetCommit, relativeFilePath: "board.kicad_sch" },
		expected,
	});
	const guardCases = [
		guard(
			"rejects WORKTREE as baseCommit",
			"WORKTREE",
			"HEAD",
			"Invalid commit ref",
		),
		guard("accepts WORKTREE as targetCommit", "HEAD", "WORKTREE", null),
		guard(
			"rejects WORKTREE for both base and target",
			"WORKTREE",
			"WORKTREE",
			"Invalid commit ref",
		),
		guard("accepts normal commit refs", "main", "HEAD", null),
	];

	for (const { desc, params, expected } of guardCases) {
		test(`validateDiffGuards ${desc}`, () => {
			const result = validateDiffGuards(params);
			assert.equal(result, expected);
		});
	}
});
