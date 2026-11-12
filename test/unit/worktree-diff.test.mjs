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
	for (const f of cleanFiles) {
		try {
			if (fs.existsSync(f)) fs.unlinkSync(f);
		} catch (_) {
			// Ignore temp file cleanup error
		}
	}
	for (const d of tempDirs) {
		try {
			if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
		} catch (_) {
			// Ignore temp directory cleanup error
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

	test("extractWorkingTreeFile copies modified content without caching", async () => {
		const mod1 = "(kicad_sch (version 20231120) (comment modified_1))";
		fs.writeFileSync(schFile, mod1);
		const targetName = "wt_test_target.kicad_sch";
		const outPath1 = await extractWorkingTreeFile(
			repoDir,
			"board.kicad_sch",
			targetName,
		);
		cleanFiles.push(outPath1);
		assert.equal(fs.readFileSync(outPath1, "utf8"), mod1);

		const mod2 = "(kicad_sch (version 20231120) (comment modified_2))";
		fs.writeFileSync(schFile, mod2);
		const outPath2 = await extractWorkingTreeFile(
			repoDir,
			"board.kicad_sch",
			targetName,
		);
		assert.equal(outPath2, outPath1);
		assert.equal(fs.readFileSync(outPath2, "utf8"), mod2);
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

	const guardCases = [
		{
			desc: "rejects WORKTREE as baseCommit",
			params: {
				baseCommit: "WORKTREE",
				targetCommit: "HEAD",
				relativeFilePath: "board.kicad_sch",
			},
			expected: "Invalid commit ref",
		},
		{
			desc: "accepts WORKTREE as targetCommit",
			params: {
				baseCommit: "HEAD",
				targetCommit: "WORKTREE",
				relativeFilePath: "board.kicad_sch",
			},
			expected: null,
		},
		{
			desc: "rejects WORKTREE for both base and target",
			params: {
				baseCommit: "WORKTREE",
				targetCommit: "WORKTREE",
				relativeFilePath: "board.kicad_sch",
			},
			expected: "Invalid commit ref",
		},
		{
			desc: "accepts normal commit refs",
			params: {
				baseCommit: "main",
				targetCommit: "HEAD",
				relativeFilePath: "board.kicad_sch",
			},
			expected: null,
		},
	];

	for (const { desc, params, expected } of guardCases) {
		test(`validateDiffGuards ${desc}`, () => {
			const result = validateDiffGuards(params);
			assert.equal(result, expected);
		});
	}
});
