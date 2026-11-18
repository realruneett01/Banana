import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerPatchTools } from "../../backend/src/engine/tools/patch-tools.js";
import {
	buildHostedRegistry,
	buildLocalRegistry,
} from "../../backend/src/routes/agent-routes.js";

const SAMPLE_SCH = `(kicad_sch
	(version 20240108)
	(generator "banana")
	(symbol (lib_id "Device:R") (at 30 40 90)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

const SAMPLE_PCB = `(kicad_pcb
	(version 20240108)
	(generator "banana")
	(footprint "Resistor_SMD:R_0603"
		(at 10 20 45)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

const REPO_DIR = path.resolve("/fake/repo");
const COMMIT_HASH = "0123456789abcdef0123456789abcdef01234567";
const DEFAULT_EDITS = [{ ref: "R1", op: "setValue", value: "20k" }];
const SCH_PATH = path.resolve(REPO_DIR, "hardware/board.kicad_sch");
const PCB_PATH = path.resolve(REPO_DIR, "hardware/board.kicad_pcb");

const schItem = (filePath = "board.kicad_sch", edits = DEFAULT_EDITS) => ({
	path: filePath,
	kind: "sch",
	edits,
});

const pcbItem = (filePath = "board.kicad_pcb", edits = DEFAULT_EDITS) => ({
	path: filePath,
	kind: "pcb",
	edits,
});

const resultItem = (filePath) => ({ path: filePath, applied: 1, skipped: [] });
const patchedSchText = (text, edits) =>
	patchKicadText(text, { kind: "sch", edits }).text;
const patchedPcbText = (text, edits) =>
	patchKicadText(text, { kind: "pcb", edits }).text;
const gitArgs = (...args) => ["-C", REPO_DIR, ...args];

function makePayload(overrides = {}) {
	return {
		repoPath: REPO_DIR,
		files: [schItem()],
		message: "Patch resistor",
		...overrides,
	};
}

function createExecFn(isWorkTree, commitHash) {
	return (args) => {
		if (args.includes("--is-inside-work-tree")) {
			return isWorkTree ? "true\n" : "false\n";
		}
		if (args.includes("HEAD")) {
			return `${commitHash}\n`;
		}
		return "";
	};
}

function createFsImpl(disk, written, realMap) {
	const fsImpl = {
		async readFile(p) {
			const data = disk.get(p);
			if (data !== undefined) return data;
			throw new Error(`ENOENT: ${p}`);
		},
		async writeFile(p, data) {
			written.set(p, data);
		},
	};
	if (realMap) {
		fsImpl.realpath = async (p) => {
			const real = realMap.get(p);
			if (real !== undefined) return real;
			throw new Error(`ENOENT: ${p}`);
		};
	}
	return fsImpl;
}

function makeHarness({
	files = {},
	realPaths = null,
	isWorkTree = true,
	commitHash = COMMIT_HASH,
} = {}) {
	const disk = new Map(Object.entries(files));
	const written = new Map();
	const calls = [];
	const realMap = realPaths ? new Map(Object.entries(realPaths)) : null;
	const fsImpl = createFsImpl(disk, written, realMap);
	const getOutput = createExecFn(isWorkTree, commitHash);
	const execFileFn = async (cmd, args, opts) => {
		calls.push({ cmd, args, opts });
		return { stdout: getOutput(args) };
	};
	const registry = createRegistry();
	registerPatchTools(registry, { execFileFn, fsImpl });
	return {
		registry,
		fakeFs: { files: disk, written, fsImpl },
		fakeExec: { calls, execFileFn },
	};
}

function callPatch(
	registry,
	filesOrPayload,
	message = "Patch",
	options = { approved: true },
) {
	const payload = Array.isArray(filesOrPayload)
		? { repoPath: REPO_DIR, files: filesOrPayload, message }
		: filesOrPayload;
	return registry.call("design.patch", payload, options);
}

function assertRejected(
	res,
	harness,
	errorPattern = null,
	requireZeroGit = false,
) {
	assert.equal(res.ok, false);
	if (typeof errorPattern === "string") {
		assert.equal(res.error, errorPattern);
	} else if (errorPattern) {
		assert.match(res.error, errorPattern);
	}
	assert.equal(harness.fakeFs.written.size, 0);
	if (requireZeroGit) {
		assert.equal(harness.fakeExec.calls.length, 0);
		return;
	}
	const gitWrites = harness.fakeExec.calls.filter(
		(c) => c.args.includes("add") || c.args.includes("commit"),
	);
	assert.equal(gitWrites.length, 0);
}

function assertHappyPathResults(res, harness, tc) {
	for (const [filePath, expectedContent] of tc.expectedWrites) {
		assert.equal(harness.fakeFs.written.get(filePath), expectedContent);
	}
	const addCall = harness.fakeExec.calls.find((c) => c.args.includes("add"));
	const commitCall = harness.fakeExec.calls.find((c) =>
		c.args.includes("commit"),
	);
	assert.deepEqual(
		{
			ok: res.ok,
			files: res.output.files,
			commit: res.output.commit,
			addArgs: addCall?.args,
			commitArgs: tc.expectedCommitArgs ? commitCall?.args : undefined,
		},
		{
			ok: true,
			files: tc.expectedFiles,
			commit: COMMIT_HASH,
			addArgs: tc.expectedAddArgs,
			commitArgs: tc.expectedCommitArgs,
		},
	);
}

describe("engine-patch-tools registration and metadata", () => {
	test("exports registerPatchTools function", () => {
		assert.equal(typeof registerPatchTools, "function");
	});

	test("registers design.patch with permission destructive", () => {
		const registry = createRegistry();
		registerPatchTools(registry);
		const tools = registry.list();
		assert.equal(tools.length, 1);
		const [tool] = tools;
		assert.deepEqual(
			{
				name: tool.name,
				permission: tool.permission,
				hasSchema: Boolean(tool.inputSchema),
				hasDesc: typeof tool.description === "string",
			},
			{
				name: "design.patch",
				permission: "destructive",
				hasSchema: true,
				hasDesc: true,
			},
		);
	});

	test("refuses execution when approved is not true", async () => {
		const harness = makeHarness();
		const res = await callPatch(
			harness.registry,
			[schItem()],
			"Patch resistor",
			{},
		);
		assert.deepEqual(
			{ ok: res.ok, error: res.error },
			{ ok: false, error: "approval required" },
		);
	});
});

describe("engine-patch-tools happy paths", () => {
	test("happy path for one sch file", async () => {
		const harness = makeHarness({ files: { [SCH_PATH]: SAMPLE_SCH } });
		const fileRel = "hardware/board.kicad_sch";
		const res = await callPatch(
			harness.registry,
			[schItem(fileRel)],
			"Update R1 value",
		);
		assertHappyPathResults(res, harness, {
			expectedWrites: [[SCH_PATH, patchedSchText(SAMPLE_SCH, DEFAULT_EDITS)]],
			expectedFiles: [resultItem(fileRel)],
			expectedAddArgs: gitArgs("add", "--", fileRel),
			expectedCommitArgs: gitArgs(
				"commit",
				"-m",
				"Update R1 value",
				"--",
				fileRel,
			),
		});
	});

	test("happy path for sch plus pcb", async () => {
		const harness = makeHarness({
			files: { [SCH_PATH]: SAMPLE_SCH, [PCB_PATH]: SAMPLE_PCB },
		});
		const schRel = "hardware/board.kicad_sch";
		const pcbRel = "hardware/board.kicad_pcb";
		const schEdits = [{ ref: "R1", op: "setValue", value: "22k" }];
		const pcbEdits = [{ ref: "R1", op: "move", x: 15, y: 25, rot: 90 }];
		const res = await callPatch(
			harness.registry,
			[schItem(schRel, schEdits), pcbItem(pcbRel, pcbEdits)],
			"Update R1 schema and layout",
		);
		assertHappyPathResults(res, harness, {
			expectedWrites: [
				[SCH_PATH, patchedSchText(SAMPLE_SCH, schEdits)],
				[PCB_PATH, patchedPcbText(SAMPLE_PCB, pcbEdits)],
			],
			expectedFiles: [resultItem(schRel), resultItem(pcbRel)],
			expectedAddArgs: gitArgs("add", "--", schRel, pcbRel),
		});
	});
});

describe("engine-patch-tools path attack validations", () => {
	const attacks = [
		["absolute path posix", "/outside/board.kicad_sch", "sch"],
		["drive letter", "C:board.kicad_sch", "sch"],
		["../ traversal", "../outside.kicad_sch", "sch"],
		["backslash traversal", "..\\outside.kicad_sch", "sch"],
		["wrong extension for sch", "board.kicad_pcb", "sch"],
		["wrong extension for pcb", "board.kicad_sch", "pcb"],
		["path outside repo", "sub/../../outside.kicad_sch", "sch"],
	];

	for (const [name, targetPath, kind] of attacks) {
		test(`rejects attack: ${name}`, async () => {
			const harness = makeHarness();
			const files = [{ path: targetPath, kind, edits: DEFAULT_EDITS }];
			const res = await callPatch(harness.registry, files, "Attack attempt");
			assertRejected(res, harness);
		});
	}
});

describe("engine-patch-tools input boundary validations", () => {
	const cases = [
		[
			"rejects more than 2 files",
			makePayload({
				files: [
					schItem("f1.kicad_sch"),
					schItem("f2.kicad_sch"),
					schItem("f3.kicad_sch"),
				],
				message: "Three files",
			}),
			null,
			{},
			true,
		],
		[
			"rejects 0 files",
			makePayload({ files: [], message: "Empty files" }),
			null,
			{},
			true,
		],
		[
			"rejects more than 500 edits",
			makePayload({
				files: [
					schItem(
						"board.kicad_sch",
						Array.from({ length: 501 }, () => ({
							ref: "R1",
							op: "setValue",
							value: "1k",
						})),
					),
				],
				message: "Too many edits",
			}),
			null,
			{},
			true,
		],
		[
			"rejects non-absolute repoPath",
			makePayload({ repoPath: "relative/repo", message: "Relative repoPath" }),
			/absolute/i,
			{},
			true,
		],
		[
			"rejects invalid message len=0",
			makePayload({ message: "" }),
			null,
			{},
			true,
		],
		[
			"rejects invalid message len=201",
			makePayload({ message: "m".repeat(201) }),
			null,
			{},
			true,
		],
		[
			"rejects when repoPath is not inside a git work tree",
			makePayload({ message: "Not work tree" }),
			/git work tree/i,
			{ [path.resolve(REPO_DIR, "board.kicad_sch")]: SAMPLE_SCH },
			false,
		],
	];

	for (const [name, payload, errMatch, setupFiles, isWorkTree] of cases) {
		test(name, async () => {
			const harness = makeHarness({ files: setupFiles, isWorkTree });
			const res = await callPatch(harness.registry, payload);
			assertRejected(res, harness, errMatch);
		});
	}
});

describe("engine-patch-tools failure modes and all-or-nothing", () => {
	const cases = [
		[
			"unreadable file: nothing written, no git add/commit",
			{},
			[schItem("missing.kicad_sch")],
			"Unreadable",
			/Failed to read file/i,
		],
		[
			"unparseable file: nothing written, no git add/commit",
			{ [path.resolve(REPO_DIR, "corrupt.kicad_sch")]: "(kicad_sch broken (" },
			[schItem("corrupt.kicad_sch")],
			"Corrupt file",
			/Failed to patch/i,
		],
		[
			"zero applied edits: nothing written, no git add/commit",
			{ [path.resolve(REPO_DIR, "board.kicad_sch")]: SAMPLE_SCH },
			[
				schItem("board.kicad_sch", [
					{ ref: "UNKNOWN_REF", op: "setValue", value: "20k" },
				]),
			],
			"No-op edits",
			/No edits were applied/i,
		],
		[
			"second file failing means the first is NOT written (all-or-nothing)",
			{
				[path.resolve(REPO_DIR, "good.kicad_sch")]: SAMPLE_SCH,
				[path.resolve(REPO_DIR, "bad.kicad_pcb")]: "(kicad_pcb broken (",
			},
			[schItem("good.kicad_sch"), pcbItem("bad.kicad_pcb")],
			"Atomic transaction test",
			/Failed to patch/i,
		],
	];

	for (const [name, setupFiles, files, message, errorMatch] of cases) {
		test(name, async () => {
			const harness = makeHarness({ files: setupFiles });
			const res = await callPatch(harness.registry, files, message);
			assertRejected(res, harness, errorMatch);
		});
	}
});

describe("engine-patch-tools hardening and registry integration", () => {
	const duplicateCases = [
		[
			"rejects duplicate path: exact duplicate",
			[
				schItem("hardware/board.kicad_sch"),
				schItem("hardware/board.kicad_sch"),
			],
			{},
			null,
		],
		[
			"rejects duplicate path: normalized dot-slash duplicate",
			[
				schItem("hardware/board.kicad_sch"),
				schItem("hardware/./board.kicad_sch"),
			],
			{},
			null,
		],
		[
			"rejects symlink whose realpath is outside repoPath",
			[schItem("hardware/board.kicad_sch")],
			{ [path.resolve(REPO_DIR, "hardware/board.kicad_sch")]: SAMPLE_SCH },
			{
				[REPO_DIR]: REPO_DIR,
				[path.resolve(REPO_DIR, "hardware/board.kicad_sch")]: path.resolve(
					"/outside/evil.kicad_sch",
				),
			},
		],
	];

	for (const [name, files, setupFiles, realPaths] of duplicateCases) {
		test(name, async () => {
			const harness = makeHarness({ files: setupFiles, realPaths });
			const msg = name.includes("symlink")
				? "Symlink outside repo"
				: "Duplicate path test";
			const expectedErr = name.includes("symlink")
				? "path resolves outside repoPath"
				: "files must not repeat the same path";
			const res = await callPatch(harness.registry, files, msg);
			assertRejected(res, harness, expectedErr, true);
		});
	}

	test("allows normal file with realpath inside repoPath", async () => {
		const schPath = path.resolve(REPO_DIR, "hardware/board.kicad_sch");
		const harness = makeHarness({
			files: { [schPath]: SAMPLE_SCH },
			realPaths: {
				[REPO_DIR]: REPO_DIR,
				[schPath]: schPath,
			},
		});
		const res = await callPatch(
			harness.registry,
			[schItem("hardware/board.kicad_sch")],
			"Valid realpath",
		);
		assert.deepEqual(
			{
				ok: res.ok,
				written: harness.fakeFs.written.has(schPath),
				commit: res.output?.commit,
			},
			{ ok: true, written: true, commit: COMMIT_HASH },
		);
	});

	test("buildLocalRegistry contains design.patch", () => {
		const registry = buildLocalRegistry();
		const tool = registry.list().find((t) => t.name === "design.patch");
		assert.deepEqual(
			tool ? { name: tool.name, permission: tool.permission } : null,
			{ name: "design.patch", permission: "destructive" },
		);
	});

	test("buildHostedRegistry excludes design.patch, design.commit and destructive tools", () => {
		const hosted = buildHostedRegistry();
		const tools = hosted.list();
		const names = new Set(tools.map((t) => t.name));
		const destructiveCount = tools.filter(
			(t) => t.permission === "destructive",
		).length;
		assert.deepEqual(
			{
				hasPatch: names.has("design.patch"),
				hasCommit: names.has("design.commit"),
				destructiveCount,
			},
			{ hasPatch: false, hasCommit: false, destructiveCount: 0 },
		);
	});
});
