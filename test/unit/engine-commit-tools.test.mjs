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
	} catch (err) {
		if (err) {
			return false;
		}
		return false;
	}
}

const gitAvailable = hasGitCli();

function makeNet(name, pin1, pin2) {
	return {
		id: newId("net"),
		name,
		pins: [pin1, pin2],
	};
}

function makeCleanIR() {
	const [p1, p2] = [newId("part"), newId("part")];
	const part = (id, ref) => ({
		id,
		ref,
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
	});
	return {
		schemaVersion: 1,
		name: "CommitTestDesign",
		parts: [part(p1, "R1"), part(p2, "R2")],
		nets: [
			makeNet("VCC", { partId: p1, pin: "1" }, { partId: p2, pin: "1" }),
			makeNet("GND", { partId: p1, pin: "2" }, { partId: p2, pin: "2" }),
		],
		constraints: [
			{ id: "c1", kind: "rail", target: "VCC", value: 3.3, unit: "V" },
		],
	};
}

function makeBasePayload(overrides = {}) {
	return {
		repoPath: path.resolve("."),
		baseName: "Board",
		ir: makeCleanIR(),
		boardW: 100,
		boardH: 80,
		message: "Update",
		...overrides,
	};
}

function buildTestRegistry() {
	const registry = createRegistry();
	registerCommitTools(registry);
	return registry;
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

async function createTestGitRepo(tempDirs) {
	const repoDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "banana-commit-test-"),
	);
	tempDirs.push(repoDir);
	initTempGitRepo(repoDir);
	return repoDir;
}

async function cleanTempDirs(dirs) {
	await Promise.all(
		dirs.map(async (dir) => {
			try {
				await fs.promises.rm(dir, { recursive: true, force: true });
			} catch (err) {
				if (err && err.code !== "ENOENT") {
					return err;
				}
				return null;
			}
		}),
	);
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
		const registry = buildTestRegistry();
		const tools = registry.list();
		assert.equal(tools.length, 1);
		const [tool] = tools;
		assert.ok(tool.inputSchema);
		assert.equal(typeof tool.description, "string");
		assert.equal(tool.name, "design.commit");
		assert.equal(tool.permission, "destructive");
	});

	test("refuses execution when approved is not true", async () => {
		const registry = buildTestRegistry();
		const payload = makeBasePayload({
			repoPath: path.resolve("some/repo"),
			message: "Commit message",
		});
		const res = await registry.call("design.commit", payload);
		assert.equal(res.ok, false);
		assert.equal(res.error, "approval required");
	});
});

const VALIDATION_CASES = [
	{
		name: "rejects invalid IR",
		getPayload: () =>
			makeBasePayload({ ir: { schemaVersion: 999, name: "Broken" } }),
		pattern: /Invalid circuit IR/i,
	},
	{
		name: "rejects non-absolute repoPath",
		getPayload: () => makeBasePayload({ repoPath: "relative/path/repo" }),
		pattern: /absolute/i,
	},
	{
		name: "rejects non-git-repo directory",
		skipIfNoGit: true,
		getPayload: async (dirs) => {
			const nonRepo = await fs.promises.mkdtemp(
				path.join(os.tmpdir(), "banana-non-repo-"),
			);
			dirs.push(nonRepo);
			return makeBasePayload({ repoPath: nonRepo });
		},
		pattern: /git work tree/i,
	},
	...["../outside", "/absolute/dir", "a/../../b"].map((dir) => ({
		name: `rejects invalid dir: ${dir}`,
		getPayload: () => makeBasePayload({ dir }),
		pattern: /dir/i,
	})),
	...["", "m".repeat(201)].map((message) => ({
		name: `enforces message length for len=${message.length}`,
		getPayload: () => makeBasePayload({ message }),
		pattern: /message/i,
	})),
];

describe("engine-commit-tools validations", () => {
	const tempDirs = [];

	after(async () => {
		await cleanTempDirs(tempDirs);
	});

	for (const tc of VALIDATION_CASES) {
		test(tc.name, async (t) => {
			if (tc.skipIfNoGit && !gitAvailable) {
				t.skip("git CLI not available");
				return;
			}
			const registry = buildTestRegistry();
			const payload = await tc.getPayload(tempDirs);
			const res = await registry.call("design.commit", payload, {
				approved: true,
			});
			assert.equal(res.ok, false);
			assert.match(res.error, tc.pattern);
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
		const repoDir = await createTestGitRepo(tempDirs);
		const registry = buildTestRegistry();
		const payload = makeBasePayload({
			repoPath: repoDir,
			baseName: "MyBoard",
			boardW: 120,
			boardH: 90,
			message: "Add MyBoard design",
		});
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
