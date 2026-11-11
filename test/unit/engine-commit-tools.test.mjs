import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerCommitTools } from "../../backend/src/engine/tools/commit-tools.js";

function hasGitCli() {
	try {
		execFileSync("git", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		// Broad catch: return false if git binary is absent or unexecutable
		return false;
	}
}

const gitAvailable = hasGitCli();

function makePart(ref, overrides = {}) {
	return {
		id: newId("part"),
		ref,
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		...overrides,
	};
}

function makeCleanIR() {
	const parts = [makePart("R1"), makePart("R2")];
	const linkNet = (id, name, pin) => ({
		id,
		name,
		pins: parts.map((p) => ({ partId: p.id, pin })),
	});
	return {
		schemaVersion: 1,
		name: "CommitTestDesign",
		parts,
		nets: [
			linkNet(newId("net"), "VCC", "1"),
			linkNet(newId("net"), "GND", "2"),
		],
		constraints: [
			{ id: "c1", kind: "rail", target: "VCC", value: 3.3, unit: "V" },
		],
	};
}

function initTempGitRepo(repoPath) {
	execFileSync("git", ["init", repoPath]);
	execFileSync("git", ["-C", repoPath, "config", "user.name", "Test User"]);
	execFileSync("git", [
		"-C",
		repoPath,
		"config",
		"user.email",
		"test@banana.local",
	]);
	execFileSync("git", [
		"-C",
		repoPath,
		"commit",
		"--allow-empty",
		"-m",
		"Initial root commit",
	]);
}

async function cleanTempDirs(dirs) {
	for (const dir of dirs) {
		try {
			await fs.promises.rm(dir, { recursive: true, force: true });
		} catch {
			// Broad catch: ignore cleanup failures for ephemeral test temp directories
		}
	}
}

function assertFilesOnDisk(repoDir, baseName) {
	const sch = path.join(repoDir, "hardware", `${baseName}.kicad_sch`);
	const pcb = path.join(repoDir, "hardware", `${baseName}.kicad_pcb`);
	assert.ok(fs.existsSync(sch));
	assert.ok(fs.existsSync(pcb));
}

function assertGitCommitMetadata(repoDir, commit) {
	const diffTree = execFileSync(
		"git",
		["-C", repoDir, "diff-tree", "--no-commit-id", "--name-only", "-r", commit],
		{ encoding: "utf8" },
	);
	const files = diffTree.trim().split(/\r?\n/).sort();
	assert.deepEqual(files, [
		"hardware/MyBoard.kicad_pcb",
		"hardware/MyBoard.kicad_sch",
	]);

	const author = execFileSync(
		"git",
		["-C", repoDir, "log", "-1", "--format=%an <%ae>", commit],
		{ encoding: "utf8" },
	);
	assert.equal(author.trim(), "Banana Agent <agent@banana.local>");
}

describe("engine-commit-tools registration and metadata", () => {
	test("exports registerCommitTools function", () => {
		assert.equal(typeof registerCommitTools, "function");
	});

	test("registers design.commit with permission destructive", () => {
		const registry = createRegistry();
		registerCommitTools(registry);
		const tools = registry.list();
		assert.equal(tools.length, 1);
		const [tool] = tools;
		assert.equal(tool.name, "design.commit");
		assert.equal(tool.permission, "destructive");
		assert.equal(typeof tool.description, "string");
		assert.ok(tool.inputSchema);
	});

	test("refuses execution when approved is not true", async () => {
		const registry = createRegistry();
		registerCommitTools(registry);
		const payload = {
			repoPath: path.resolve("some/repo"),
			baseName: "Board",
			ir: makeCleanIR(),
			boardW: 100,
			boardH: 80,
			message: "Commit message",
		};
		const res = await registry.call("design.commit", payload);
		assert.equal(res.ok, false);
		assert.equal(res.error, "approval required");
	});
});

describe("engine-commit-tools validations", () => {
	const tempDirs = [];

	after(async () => {
		await cleanTempDirs(tempDirs);
	});

	test("rejects invalid IR", async () => {
		const registry = createRegistry();
		registerCommitTools(registry);
		const res = await registry.call(
			"design.commit",
			{
				repoPath: path.resolve("."),
				baseName: "Board",
				ir: { schemaVersion: 999, name: "Broken" },
				boardW: 100,
				boardH: 80,
				message: "Update",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /Invalid circuit IR/i);
	});

	test("rejects non-absolute repoPath", async () => {
		const registry = createRegistry();
		registerCommitTools(registry);
		const res = await registry.call(
			"design.commit",
			{
				repoPath: "relative/path/repo",
				baseName: "Board",
				ir: makeCleanIR(),
				boardW: 100,
				boardH: 80,
				message: "Update",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /absolute/i);
	});

	test("rejects non-git-repo directory", async (t) => {
		if (!gitAvailable) {
			t.skip("git CLI not available");
			return;
		}
		const nonRepo = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "banana-non-repo-"),
		);
		tempDirs.push(nonRepo);
		const registry = createRegistry();
		registerCommitTools(registry);
		const res = await registry.call(
			"design.commit",
			{
				repoPath: nonRepo,
				baseName: "Board",
				ir: makeCleanIR(),
				boardW: 100,
				boardH: 80,
				message: "Update",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /git work tree/i);
	});

	const TRAVERSAL_DIRS = ["../outside", "/absolute/dir", "a/../../b"];
	for (const badDir of TRAVERSAL_DIRS) {
		test(`rejects invalid dir: ${badDir}`, async () => {
			const registry = createRegistry();
			registerCommitTools(registry);
			const res = await registry.call(
				"design.commit",
				{
					repoPath: path.resolve("."),
					dir: badDir,
					baseName: "Board",
					ir: makeCleanIR(),
					boardW: 100,
					boardH: 80,
					message: "Update",
				},
				{ approved: true },
			);
			assert.equal(res.ok, false);
			assert.match(res.error, /dir/i);
		});
	}

	const INVALID_MESSAGES = ["", "m".repeat(201)];
	for (const badMsg of INVALID_MESSAGES) {
		test(`enforces message length for len=${badMsg.length}`, async () => {
			const registry = createRegistry();
			registerCommitTools(registry);
			const res = await registry.call(
				"design.commit",
				{
					repoPath: path.resolve("."),
					baseName: "Board",
					ir: makeCleanIR(),
					boardW: 100,
					boardH: 80,
					message: badMsg,
				},
				{ approved: true },
			);
			assert.equal(res.ok, false);
			assert.match(res.error, /message/i);
		});
	}
});

describe("engine-commit-tools git operations", () => {
	const tempDirs = [];

	after(async () => {
		await cleanTempDirs(tempDirs);
	});

	test("happy path commits exactly the two KiCad files", async (t) => {
		if (!gitAvailable) {
			t.skip("git CLI not available");
			return;
		}
		const repoDir = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "banana-commit-test-"),
		);
		tempDirs.push(repoDir);
		initTempGitRepo(repoDir);

		const registry = createRegistry();
		registerCommitTools(registry);
		const payload = {
			repoPath: repoDir,
			baseName: "MyBoard",
			ir: makeCleanIR(),
			boardW: 120,
			boardH: 90,
			message: "Add MyBoard design",
		};
		const res = await registry.call("design.commit", payload, {
			approved: true,
		});

		assert.equal(res.ok, true);
		assert.match(res.output?.commit, /^[0-9a-f]{40}$/);
		assert.deepEqual(res.output.files, [
			"hardware/MyBoard.kicad_sch",
			"hardware/MyBoard.kicad_pcb",
		]);
		assertFilesOnDisk(repoDir, "MyBoard");
		assertGitCommitMetadata(repoDir, res.output.commit);
	});
});
