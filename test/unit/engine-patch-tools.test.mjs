import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerPatchTools } from "../../backend/src/engine/tools/patch-tools.js";

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

function createFakeFs(initialFiles = {}) {
	const files = new Map(Object.entries(initialFiles));
	const written = new Map();
	const readFile = async (p) => {
		if (!files.has(p)) {
			throw new Error(`ENOENT: ${p}`);
		}
		return files.get(p);
	};
	const writeFile = async (p, data) => {
		written.set(p, data);
	};
	return { files, written, fsImpl: { readFile, writeFile } };
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

function setupToolHarness(fsFiles = {}, execOptions = {}) {
	const fakeFs = createFakeFs(fsFiles);
	const fakeExec = createFakeExecFile(execOptions);
	const registry = createRegistry();
	registerPatchTools(registry, {
		execFileFn: fakeExec.execFileFn,
		fsImpl: fakeFs.fsImpl,
	});
	return { registry, fakeFs, fakeExec };
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
		assert.equal(tool.name, "design.patch");
		assert.equal(tool.permission, "destructive");
		assert.equal(typeof tool.description, "string");
		assert.ok(tool.inputSchema);
	});

	test("refuses execution when approved is not true", async () => {
		const { registry } = setupToolHarness();
		const res = await registry.call("design.patch", {
			repoPath: REPO_DIR,
			files: [
				{
					path: "board.kicad_sch",
					kind: "sch",
					edits: [{ ref: "R1", op: "setValue", value: "20k" }],
				},
			],
			message: "Patch resistor",
		});
		assert.equal(res.ok, false);
		assert.equal(res.error, "approval required");
	});
});

describe("engine-patch-tools happy paths", () => {
	test("happy path for one sch file", async () => {
		const schPath = path.resolve(REPO_DIR, "hardware/board.kicad_sch");
		const { registry, fakeFs, fakeExec } = setupToolHarness({
			[schPath]: SAMPLE_SCH,
		});

		const edits = [{ ref: "R1", op: "setValue", value: "20k" }];
		const expectedPatched = patchKicadText(SAMPLE_SCH, {
			kind: "sch",
			edits,
		}).text;

		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [{ path: "hardware/board.kicad_sch", kind: "sch", edits }],
				message: "Update R1 value",
			},
			{ approved: true },
		);

		assert.equal(res.ok, true);
		assert.equal(res.output.commit, COMMIT_HASH);
		assert.deepEqual(res.output.files, [
			{ path: "hardware/board.kicad_sch", applied: 1, skipped: [] },
		]);
		assert.equal(fakeFs.written.get(schPath), expectedPatched);

		const addCall = fakeExec.calls.find((c) => c.args.includes("add"));
		assert.deepEqual(addCall.args, [
			"-C",
			REPO_DIR,
			"add",
			"--",
			"hardware/board.kicad_sch",
		]);

		const commitCall = fakeExec.calls.find((c) => c.args.includes("commit"));
		assert.deepEqual(commitCall.args, [
			"-C",
			REPO_DIR,
			"commit",
			"-m",
			"Update R1 value",
			"--",
			"hardware/board.kicad_sch",
		]);
	});

	test("happy path for sch plus pcb", async () => {
		const schPath = path.resolve(REPO_DIR, "hardware/board.kicad_sch");
		const pcbPath = path.resolve(REPO_DIR, "hardware/board.kicad_pcb");
		const { registry, fakeFs, fakeExec } = setupToolHarness({
			[schPath]: SAMPLE_SCH,
			[pcbPath]: SAMPLE_PCB,
		});

		const schEdits = [{ ref: "R1", op: "setValue", value: "22k" }];
		const pcbEdits = [{ ref: "R1", op: "move", x: 15, y: 25, rot: 90 }];
		const expectedSch = patchKicadText(SAMPLE_SCH, {
			kind: "sch",
			edits: schEdits,
		}).text;
		const expectedPcb = patchKicadText(SAMPLE_PCB, {
			kind: "pcb",
			edits: pcbEdits,
		}).text;

		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [
					{ path: "hardware/board.kicad_sch", kind: "sch", edits: schEdits },
					{ path: "hardware/board.kicad_pcb", kind: "pcb", edits: pcbEdits },
				],
				message: "Update R1 schema and layout",
			},
			{ approved: true },
		);

		assert.equal(res.ok, true);
		assert.equal(res.output.commit, COMMIT_HASH);
		assert.deepEqual(res.output.files, [
			{ path: "hardware/board.kicad_sch", applied: 1, skipped: [] },
			{ path: "hardware/board.kicad_pcb", applied: 1, skipped: [] },
		]);
		assert.equal(fakeFs.written.get(schPath), expectedSch);
		assert.equal(fakeFs.written.get(pcbPath), expectedPcb);

		const addCall = fakeExec.calls.find((c) => c.args.includes("add"));
		assert.deepEqual(addCall.args, [
			"-C",
			REPO_DIR,
			"add",
			"--",
			"hardware/board.kicad_sch",
			"hardware/board.kicad_pcb",
		]);
	});
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
			const res = await registry.call(
				"design.patch",
				{
					repoPath: REPO_DIR,
					files: [
						{
							path: tc.path,
							kind: tc.kind,
							edits: [{ ref: "R1", op: "setValue", value: "20k" }],
						},
					],
					message: "Attack attempt",
				},
				{ approved: true },
			);

			assert.equal(res.ok, false);
			assertNothingCommitted(fakeFs, fakeExec);
		});
	}
});

describe("engine-patch-tools input boundary validations", () => {
	test("rejects more than 2 files", async () => {
		const { registry, fakeFs, fakeExec } = setupToolHarness();
		const edit = [{ ref: "R1", op: "setValue", value: "20k" }];
		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [
					{ path: "f1.kicad_sch", kind: "sch", edits: edit },
					{ path: "f2.kicad_sch", kind: "sch", edits: edit },
					{ path: "f3.kicad_sch", kind: "sch", edits: edit },
				],
				message: "Three files",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assertNothingCommitted(fakeFs, fakeExec);
	});

	test("rejects 0 files", async () => {
		const { registry, fakeFs, fakeExec } = setupToolHarness();
		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [],
				message: "Empty files",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assertNothingCommitted(fakeFs, fakeExec);
	});

	test("rejects more than 500 edits", async () => {
		const { registry, fakeFs, fakeExec } = setupToolHarness();
		const edits = Array.from({ length: 501 }, () => ({
			ref: "R1",
			op: "setValue",
			value: "1k",
		}));
		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [{ path: "board.kicad_sch", kind: "sch", edits }],
				message: "Too many edits",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assertNothingCommitted(fakeFs, fakeExec);
	});

	test("rejects non-absolute repoPath", async () => {
		const { registry, fakeFs, fakeExec } = setupToolHarness();
		const res = await registry.call(
			"design.patch",
			{
				repoPath: "relative/repo",
				files: [
					{
						path: "board.kicad_sch",
						kind: "sch",
						edits: [{ ref: "R1", op: "setValue", value: "20k" }],
					},
				],
				message: "Relative repoPath",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /absolute/i);
		assertNothingCommitted(fakeFs, fakeExec);
	});

	const BAD_MESSAGES = ["", "m".repeat(201)];
	for (const msg of BAD_MESSAGES) {
		test(`rejects invalid message len=${msg.length}`, async () => {
			const { registry, fakeFs, fakeExec } = setupToolHarness();
			const res = await registry.call(
				"design.patch",
				{
					repoPath: REPO_DIR,
					files: [
						{
							path: "board.kicad_sch",
							kind: "sch",
							edits: [{ ref: "R1", op: "setValue", value: "20k" }],
						},
					],
					message: msg,
				},
				{ approved: true },
			);
			assert.equal(res.ok, false);
			assertNothingCommitted(fakeFs, fakeExec);
		});
	}

	test("rejects when repoPath is not inside a git work tree", async () => {
		const schPath = path.resolve(REPO_DIR, "board.kicad_sch");
		const { registry, fakeFs, fakeExec } = setupToolHarness(
			{ [schPath]: SAMPLE_SCH },
			{ isWorkTree: false },
		);

		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [
					{
						path: "board.kicad_sch",
						kind: "sch",
						edits: [{ ref: "R1", op: "setValue", value: "20k" }],
					},
				],
				message: "Not work tree",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /git work tree/i);
		assertNothingCommitted(fakeFs, fakeExec);
	});
});

describe("engine-patch-tools failure modes and all-or-nothing", () => {
	test("unreadable file: nothing written, no git add/commit", async () => {
		const { registry, fakeFs, fakeExec } = setupToolHarness({});
		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [
					{
						path: "missing.kicad_sch",
						kind: "sch",
						edits: [{ ref: "R1", op: "setValue", value: "20k" }],
					},
				],
				message: "Unreadable",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /Failed to read file/i);
		assertNothingCommitted(fakeFs, fakeExec);
	});

	test("unparseable file: nothing written, no git add/commit", async () => {
		const schPath = path.resolve(REPO_DIR, "corrupt.kicad_sch");
		const { registry, fakeFs, fakeExec } = setupToolHarness({
			[schPath]: "(kicad_sch broken (",
		});
		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [
					{
						path: "corrupt.kicad_sch",
						kind: "sch",
						edits: [{ ref: "R1", op: "setValue", value: "20k" }],
					},
				],
				message: "Corrupt file",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /Failed to patch/i);
		assertNothingCommitted(fakeFs, fakeExec);
	});

	test("zero applied edits: nothing written, no git add/commit", async () => {
		const schPath = path.resolve(REPO_DIR, "board.kicad_sch");
		const { registry, fakeFs, fakeExec } = setupToolHarness({
			[schPath]: SAMPLE_SCH,
		});
		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [
					{
						path: "board.kicad_sch",
						kind: "sch",
						edits: [{ ref: "UNKNOWN_REF", op: "setValue", value: "20k" }],
					},
				],
				message: "No-op edits",
			},
			{ approved: true },
		);
		assert.equal(res.ok, false);
		assert.match(res.error, /No edits were applied/i);
		assertNothingCommitted(fakeFs, fakeExec);
	});

	test("second file failing means the first is NOT written (all-or-nothing)", async () => {
		const schPath = path.resolve(REPO_DIR, "good.kicad_sch");
		const pcbPath = path.resolve(REPO_DIR, "bad.kicad_pcb");
		const { registry, fakeFs, fakeExec } = setupToolHarness({
			[schPath]: SAMPLE_SCH,
			[pcbPath]: "(kicad_pcb broken (",
		});

		const res = await registry.call(
			"design.patch",
			{
				repoPath: REPO_DIR,
				files: [
					{
						path: "good.kicad_sch",
						kind: "sch",
						edits: [{ ref: "R1", op: "setValue", value: "20k" }],
					},
					{
						path: "bad.kicad_pcb",
						kind: "pcb",
						edits: [{ ref: "R1", op: "setValue", value: "20k" }],
					},
				],
				message: "Atomic transaction test",
			},
			{ approved: true },
		);

		assert.equal(res.ok, false);
		assert.match(res.error, /Failed to patch/i);
		assertNothingCommitted(fakeFs, fakeExec);
	});
});
