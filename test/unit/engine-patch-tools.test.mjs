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

function createFakeFs(initialFiles = {}, options = {}) {
	const files = new Map(Object.entries(initialFiles));
	const written = new Map();
	const readFile = async (p) => {
		if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
		return files.get(p);
	};
	const writeFile = async (p, data) => {
		written.set(p, data);
	};
	const fsImpl = { readFile, writeFile };
	if (options.realPaths) {
		const realMap = new Map(Object.entries(options.realPaths));
		fsImpl.realpath = async (p) => {
			if (!realMap.has(p)) throw new Error(`ENOENT: ${p}`);
			return realMap.get(p);
		};
	}
	return { files, written, fsImpl };
}

function createFakeExecFile(options = {}) {
	const calls = [];
	const isWorkTree = options.isWorkTree ?? true;
	const commitHash = options.commitHash ?? COMMIT_HASH;
	const execFileFn = async (cmd, args, opts) => {
		calls.push({ cmd, args, opts });
		if (args.includes("--is-inside-work-tree")) {
			return { stdout: isWorkTree ? "true\n" : "false\n" };
		}
		if (args.includes("HEAD")) {
			return { stdout: `${commitHash}\n` };
		}
		return { stdout: "" };
	};
	return { calls, execFileFn };
}

function assertNothingCommitted(fakeFs, fakeExec) {
	assert.equal(fakeFs.written.size, 0);
	const gitWrites = fakeExec.calls.filter(
		(c) => c.args.includes("add") || c.args.includes("commit"),
	);
	assert.equal(gitWrites.length, 0);
}

function setupToolHarness(fsFiles = {}, execOptions = {}, fsOptions = {}) {
	const fakeFs = createFakeFs(fsFiles, fsOptions);
	const fakeExec = createFakeExecFile(execOptions);
	const registry = createRegistry();
	registerPatchTools(registry, {
		execFileFn: fakeExec.execFileFn,
		fsImpl: fakeFs.fsImpl,
	});
	return { registry, fakeFs, fakeExec };
}

// Approved design.patch call against REPO_DIR.
function callPatch(registry, files, message) {
	return registry.call(
		"design.patch",
		{ repoPath: REPO_DIR, files, message },
		{ approved: true },
	);
}

function assertRejected(res, fakeFs, fakeExec, errorMatch) {
	assert.equal(res.ok, false);
	if (errorMatch) assert.match(res.error, errorMatch);
	assertNothingCommitted(fakeFs, fakeExec);
}

function assertHappyPathResults(res, fakeFs, fakeExec, tc) {
	for (const [filePath, expectedContent] of tc.expectedWrites) {
		assert.equal(fakeFs.written.get(filePath), expectedContent);
	}
	assert.equal(res.ok, true);
	assert.deepEqual(res.output.files, tc.expectedFiles);
	assert.equal(res.output.commit, COMMIT_HASH);
	const addCall = fakeExec.calls.find((c) => c.args.includes("add"));
	assert.deepEqual(addCall.args, tc.expectedAddArgs);
	if (tc.expectedCommitArgs) {
		const commitCall = fakeExec.calls.find((c) => c.args.includes("commit"));
		assert.deepEqual(commitCall.args, tc.expectedCommitArgs);
	}
}

const HAPPY_PATH_CASES = [
	{
		name: "happy path for one sch file",
		initialFiles: { [SCH_PATH]: SAMPLE_SCH },
		files: [
			{
				path: "hardware/board.kicad_sch",
				kind: "sch",
				edits: DEFAULT_EDITS,
			},
		],
		message: "Update R1 value",
		expectedFiles: [
			{ path: "hardware/board.kicad_sch", applied: 1, skipped: [] },
		],
		expectedWrites: [
			[
				SCH_PATH,
				patchKicadText(SAMPLE_SCH, {
					kind: "sch",
					edits: DEFAULT_EDITS,
				}).text,
			],
		],
		expectedAddArgs: ["-C", REPO_DIR, "add", "--", "hardware/board.kicad_sch"],
		expectedCommitArgs: [
			"-C",
			REPO_DIR,
			"commit",
			"-m",
			"Update R1 value",
			"--",
			"hardware/board.kicad_sch",
		],
	},
	{
		name: "happy path for sch plus pcb",
		initialFiles: {
			[SCH_PATH]: SAMPLE_SCH,
			[PCB_PATH]: SAMPLE_PCB,
		},
		files: [
			{
				path: "hardware/board.kicad_sch",
				kind: "sch",
				edits: [{ ref: "R1", op: "setValue", value: "22k" }],
			},
			{
				path: "hardware/board.kicad_pcb",
				kind: "pcb",
				edits: [{ ref: "R1", op: "move", x: 15, y: 25, rot: 90 }],
			},
		],
		message: "Update R1 schema and layout",
		expectedFiles: [
			{ path: "hardware/board.kicad_sch", applied: 1, skipped: [] },
			{ path: "hardware/board.kicad_pcb", applied: 1, skipped: [] },
		],
		expectedWrites: [
			[
				SCH_PATH,
				patchKicadText(SAMPLE_SCH, {
					kind: "sch",
					edits: [{ ref: "R1", op: "setValue", value: "22k" }],
				}).text,
			],
			[
				PCB_PATH,
				patchKicadText(SAMPLE_PCB, {
					kind: "pcb",
					edits: [{ ref: "R1", op: "move", x: 15, y: 25, rot: 90 }],
				}).text,
			],
		],
		expectedAddArgs: [
			"-C",
			REPO_DIR,
			"add",
			"--",
			"hardware/board.kicad_sch",
			"hardware/board.kicad_pcb",
		],
	},
];

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
		assert.equal(tool.name, "design.patch");
		assert.ok(tool.inputSchema);
		assert.equal(tool.permission, "destructive");
		assert.equal(typeof tool.description, "string");
	});

	test("refuses execution when approved is not true", async () => {
		const { registry } = setupToolHarness();
		const res = await registry.call("design.patch", {
			repoPath: REPO_DIR,
			files: [
				{
					path: "board.kicad_sch",
					kind: "sch",
					edits: DEFAULT_EDITS,
				},
			],
			message: "Patch resistor",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error, "approval required");
	});
});

describe("engine-patch-tools happy paths", () => {
	for (const tc of HAPPY_PATH_CASES) {
		test(tc.name, async () => {
			const { registry, fakeFs, fakeExec } = setupToolHarness(tc.initialFiles);
			const res = await callPatch(registry, tc.files, tc.message);
			assertHappyPathResults(res, fakeFs, fakeExec, tc);
		});
	}
});

describe("engine-patch-tools path attack validations", () => {
	const PATH_ATTACK_CASES = [
		{
			name: "absolute path posix",
			path: "/outside/board.kicad_sch",
			kind: "sch",
		},
		{ name: "drive letter", path: "C:board.kicad_sch", kind: "sch" },
		{ name: "../ traversal", path: "../outside.kicad_sch", kind: "sch" },
		{ name: "backslash traversal", path: "..\\outside.kicad_sch", kind: "sch" },
		{ name: "wrong extension for sch", path: "board.kicad_pcb", kind: "sch" },
		{ name: "wrong extension for pcb", path: "board.kicad_sch", kind: "pcb" },
		{
			name: "path outside repo",
			path: "sub/../../outside.kicad_sch",
			kind: "sch",
		},
	];

	for (const tc of PATH_ATTACK_CASES) {
		test(`rejects attack: ${tc.name}`, async () => {
			const { registry, fakeFs, fakeExec } = setupToolHarness();
			const files = [{ path: tc.path, kind: tc.kind, edits: DEFAULT_EDITS }];
			const res = await callPatch(registry, files, "Attack attempt");
			assertRejected(res, fakeFs, fakeExec);
		});
	}
});

describe("engine-patch-tools input boundary validations", () => {
	const BOUNDARY_CASES = [
		{
			name: "rejects more than 2 files",
			payload: {
				repoPath: REPO_DIR,
				files: [
					{ path: "f1.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
					{ path: "f2.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
					{ path: "f3.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
				],
				message: "Three files",
			},
		},
		{
			name: "rejects 0 files",
			payload: {
				repoPath: REPO_DIR,
				files: [],
				message: "Empty files",
			},
		},
		{
			name: "rejects more than 500 edits",
			payload: {
				repoPath: REPO_DIR,
				files: [
					{
						path: "board.kicad_sch",
						kind: "sch",
						edits: Array.from({ length: 501 }, () => ({
							ref: "R1",
							op: "setValue",
							value: "1k",
						})),
					},
				],
				message: "Too many edits",
			},
		},
		{
			name: "rejects non-absolute repoPath",
			payload: {
				repoPath: "relative/repo",
				files: [
					{
						path: "board.kicad_sch",
						kind: "sch",
						edits: DEFAULT_EDITS,
					},
				],
				message: "Relative repoPath",
			},
			expectedErrorMatch: /absolute/i,
		},
		{
			name: "rejects invalid message len=0",
			payload: {
				repoPath: REPO_DIR,
				files: [
					{
						path: "board.kicad_sch",
						kind: "sch",
						edits: DEFAULT_EDITS,
					},
				],
				message: "",
			},
		},
		{
			name: "rejects invalid message len=201",
			payload: {
				repoPath: REPO_DIR,
				files: [
					{
						path: "board.kicad_sch",
						kind: "sch",
						edits: DEFAULT_EDITS,
					},
				],
				message: "m".repeat(201),
			},
		},
		{
			name: "rejects when repoPath is not inside a git work tree",
			setupFiles: {
				[path.resolve(REPO_DIR, "board.kicad_sch")]: SAMPLE_SCH,
			},
			execOptions: { isWorkTree: false },
			payload: {
				repoPath: REPO_DIR,
				files: [
					{
						path: "board.kicad_sch",
						kind: "sch",
						edits: DEFAULT_EDITS,
					},
				],
				message: "Not work tree",
			},
			expectedErrorMatch: /git work tree/i,
		},
	];

	for (const tc of BOUNDARY_CASES) {
		test(tc.name, async () => {
			const { registry, fakeFs, fakeExec } = setupToolHarness(
				tc.setupFiles,
				tc.execOptions,
			);
			const res = await registry.call("design.patch", tc.payload, {
				approved: true,
			});
			assertRejected(res, fakeFs, fakeExec, tc.expectedErrorMatch);
		});
	}
});

describe("engine-patch-tools failure modes and all-or-nothing", () => {
	const FAILURE_CASES = [
		{
			name: "unreadable file: nothing written, no git add/commit",
			files: [{ path: "missing.kicad_sch", kind: "sch", edits: DEFAULT_EDITS }],
			message: "Unreadable",
			errorMatch: /Failed to read file/i,
		},
		{
			name: "unparseable file: nothing written, no git add/commit",
			setupFiles: {
				[path.resolve(REPO_DIR, "corrupt.kicad_sch")]: "(kicad_sch broken (",
			},
			files: [{ path: "corrupt.kicad_sch", kind: "sch", edits: DEFAULT_EDITS }],
			message: "Corrupt file",
			errorMatch: /Failed to patch/i,
		},
		{
			name: "zero applied edits: nothing written, no git add/commit",
			setupFiles: {
				[path.resolve(REPO_DIR, "board.kicad_sch")]: SAMPLE_SCH,
			},
			files: [
				{
					path: "board.kicad_sch",
					kind: "sch",
					edits: [{ ref: "UNKNOWN_REF", op: "setValue", value: "20k" }],
				},
			],
			message: "No-op edits",
			errorMatch: /No edits were applied/i,
		},
		{
			name: "second file failing means the first is NOT written (all-or-nothing)",
			setupFiles: {
				[path.resolve(REPO_DIR, "good.kicad_sch")]: SAMPLE_SCH,
				[path.resolve(REPO_DIR, "bad.kicad_pcb")]: "(kicad_pcb broken (",
			},
			files: [
				{ path: "good.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
				{ path: "bad.kicad_pcb", kind: "pcb", edits: DEFAULT_EDITS },
			],
			message: "Atomic transaction test",
			errorMatch: /Failed to patch/i,
		},
	];

	for (const tc of FAILURE_CASES) {
		test(tc.name, async () => {
			const { registry, fakeFs, fakeExec } = setupToolHarness(tc.setupFiles);
			const res = await callPatch(registry, tc.files, tc.message);
			assertRejected(res, fakeFs, fakeExec, tc.errorMatch);
		});
	}
});

describe("engine-patch-tools hardening and registry integration", () => {
	const HARDENING_REJECTION_CASES = [
		{
			name: "rejects duplicate path: exact duplicate",
			files: [
				{ path: "hardware/board.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
				{ path: "hardware/board.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
			],
			message: "Duplicate path test",
			expectedError: "files must not repeat the same path",
		},
		{
			name: "rejects duplicate path: normalized dot-slash duplicate",
			files: [
				{ path: "hardware/board.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
				{
					path: "hardware/./board.kicad_sch",
					kind: "sch",
					edits: DEFAULT_EDITS,
				},
			],
			message: "Duplicate path test",
			expectedError: "files must not repeat the same path",
		},
		{
			name: "rejects symlink whose realpath is outside repoPath",
			setupFiles: {
				[path.resolve(REPO_DIR, "hardware/board.kicad_sch")]: SAMPLE_SCH,
			},
			fsOptions: {
				realPaths: {
					[REPO_DIR]: REPO_DIR,
					[path.resolve(REPO_DIR, "hardware/board.kicad_sch")]: path.resolve(
						"/outside/evil.kicad_sch",
					),
				},
			},
			files: [
				{ path: "hardware/board.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
			],
			message: "Symlink outside repo",
			expectedError: "path resolves outside repoPath",
		},
	];

	for (const tc of HARDENING_REJECTION_CASES) {
		test(tc.name, async () => {
			const { registry, fakeFs, fakeExec } = setupToolHarness(
				tc.setupFiles,
				{},
				tc.fsOptions,
			);
			const res = await callPatch(registry, tc.files, tc.message);
			assert.equal(res.ok, false);
			assert.equal(res.error, tc.expectedError);
			assert.equal(fakeFs.written.size, 0);
			assert.equal(fakeExec.calls.length, 0);
		});
	}

	test("allows normal file with realpath inside repoPath", async () => {
		const schPath = path.resolve(REPO_DIR, "hardware/board.kicad_sch");
		const realPaths = {
			[REPO_DIR]: REPO_DIR,
			[schPath]: schPath,
		};
		const { registry, fakeFs } = setupToolHarness(
			{ [schPath]: SAMPLE_SCH },
			{},
			{ realPaths },
		);
		const files = [
			{ path: "hardware/board.kicad_sch", kind: "sch", edits: DEFAULT_EDITS },
		];
		const res = await callPatch(registry, files, "Valid realpath");
		assert.ok(fakeFs.written.has(schPath));
		assert.equal(res.ok, true);
		assert.equal(res.output.commit, COMMIT_HASH);
	});

	test("buildLocalRegistry contains design.patch", () => {
		const registry = buildLocalRegistry();
		const tool = registry.list().find((t) => t.name === "design.patch");
		assert.ok(tool);
		assert.equal(tool.name, "design.patch");
		assert.equal(tool.permission, "destructive");
	});

	test("buildHostedRegistry excludes design.patch, design.commit and destructive tools", () => {
		const hosted = buildHostedRegistry();
		const tools = hosted.list();
		const names = tools.map((t) => t.name);
		assert.equal(names.includes("design.patch"), false);
		assert.equal(names.includes("design.commit"), false);
		const destructive = tools.filter((t) => t.permission === "destructive");
		assert.equal(destructive.length, 0);
	});
});
