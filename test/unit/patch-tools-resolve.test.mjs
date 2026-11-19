import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerPatchTools } from "../../backend/src/engine/tools/patch-tools.js";

const REPO_DIR = path.resolve("/fake/repo");
const COMMIT_HASH = "0123456789abcdef0123456789abcdef01234567";

const SAMPLE_SCH = `(kicad_sch
	(version 20240108)
	(generator "banana")
	(uuid "00000000-0000-0000-0000-000000000001")
)`;

const SAMPLE_PCB = `(kicad_pcb
	(version 20240108)
	(generator "banana")
)`;

const SERVER_SYM =
	'(symbol "Device:R" (pin passive line (at 0 0 0) (length 2.54) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))';
const PARENT_SYM =
	'(symbol "Device:R_Parent" (pin passive line (at 0 0 0) (length 2.54) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))';
const SERVER_FP =
	'(footprint "Resistor_SMD:R_0603" (layer "F.Cu") (at 0 0) (property "Reference" "REF**" (at 0 0) (layer "F.SilkS")) (property "Value" "VAL**" (at 0 0) (layer "F.Fab")))';

function createFakeFs(initialFiles = {}) {
	const files = new Map(Object.entries(initialFiles));
	const written = new Map();
	const fsImpl = {
		async readFile(p) {
			if (files.has(p)) return files.get(p);
			throw new Error(`ENOENT: ${p}`);
		},
		async writeFile(p, data) {
			written.set(p, data);
		},
	};
	return { files, written, fsImpl };
}

function fakeStdout(args) {
	if (args.includes("--is-inside-work-tree")) return "true\n";
	return args.includes("HEAD") ? `${COMMIT_HASH}\n` : "";
}

function createFakeExecFile() {
	const calls = [];
	const execFileFn = async (cmd, args, opts) => {
		calls.push({ cmd, args, opts });
		return { stdout: fakeStdout(args) };
	};
	return { calls, execFileFn };
}

function createFakeLibrary(symMap = {}, fpMap = {}) {
	return {
		getSymbolSource: async (libId) => symMap[libId] ?? null,
		getFootprintSource: async (libId) => fpMap[libId] ?? null,
	};
}

function setupTestHarness(files, library, customPatch) {
	const fakeFs = createFakeFs(files);
	const fakeExec = createFakeExecFile();
	const registry = createRegistry();
	registerPatchTools(registry, {
		execFileFn: fakeExec.execFileFn,
		fsImpl: fakeFs.fsImpl,
		library,
		patchKicadText: customPatch ?? patchKicadText,
		// Library fixtures are placeholder text, not real KiCad symbols.
		validateKicad: async () => ({ ok: true }),
	});
	return { registry, fakeFs, fakeExec };
}

function callPatchTool(registry, tc) {
	const kind = tc.filePath.endsWith(".kicad_sch") ? "sch" : "pcb";
	return registry.call(
		"design.patch",
		{
			repoPath: REPO_DIR,
			files: [{ path: tc.filePath, kind, edits: tc.edits }],
			message: "Patch test",
		},
		{ approved: true },
	);
}

const isGitWrite = (c) => ["add", "commit"].some((a) => c.args.includes(a));

function assertFailure(res, fakeFs, fakeExec, expectedError) {
	// The call fails with the expected error, writes no file and runs no git write.
	assert.deepEqual(
		[res.ok, res.error, fakeFs.written.size, fakeExec.calls.some(isGitWrite)],
		[false, expectedError, 0, false],
	);
}

function assertSuccess(res, writtenText, capturedOpts, tc) {
	assert.equal(res.ok, true);
	assert.equal(capturedOpts.kind, tc.expectedKind);
	assert.ok(writtenText);
	for (const exp of tc.expectedInWritten) {
		assert.ok(writtenText.includes(exp));
	}
	for (const forb of tc.forbiddenInWritten) {
		assert.ok(!writtenText.includes(forb));
	}
	if (tc.expectedLibSymbol !== undefined) {
		assert.equal(capturedOpts.edits[0].libSymbol, tc.expectedLibSymbol);
	}
	if (tc.expectedParentLibSymbol !== undefined) {
		assert.equal(
			capturedOpts.edits[0].parentLibSymbol,
			tc.expectedParentLibSymbol,
		);
	}
}

async function runResolveTestCase(tc) {
	const absPath = path.resolve(REPO_DIR, tc.filePath);
	let capturedOpts = null;
	const spyPatch = (text, opts) => {
		capturedOpts = opts;
		return patchKicadText(text, opts);
	};
	const library = createFakeLibrary(tc.symMap, tc.fpMap);
	const { registry, fakeFs, fakeExec } = setupTestHarness(
		{ [absPath]: tc.fileContent },
		library,
		spyPatch,
	);
	const res = await callPatchTool(registry, tc);
	if (!tc.expectOk) {
		assertFailure(res, fakeFs, fakeExec, tc.expectedError);
		return;
	}
	assertSuccess(res, fakeFs.written.get(absPath), capturedOpts, tc);
}

const SCH_PATH = "hw/board.kicad_sch";
const PCB_PATH = "hw/board.kicad_pcb";
const MALICIOUS = {
	libSymbol: "MALICIOUS_CLIENT_SYM",
	source: "MALICIOUS_CLIENT_SRC",
};

// A case whose libId the library does not know: the call must fail cleanly.
function missingCase(name, filePath, fileContent, edit) {
	return {
		name,
		filePath,
		fileContent,
		edits: [edit],
		symMap: {},
		fpMap: {},
		expectOk: false,
		expectedError: `Library item not found: ${edit.libId}`,
	};
}

describe("patch-tools library resolution", () => {
	const TABLE_CASES = [
		{
			name: "client libSymbol stripped and replaced by server symbol",
			filePath: SCH_PATH,
			fileContent: SAMPLE_SCH,
			edits: [
				{
					op: "addSymbol",
					ref: "R1",
					libId: "Device:R",
					x: 10,
					y: 20,
					...MALICIOUS,
				},
			],
			symMap: { "Device:R": { text: SERVER_SYM, parentText: PARENT_SYM } },
			fpMap: {},
			expectOk: true,
			expectedInWritten: ['symbol "Device:R"'],
			forbiddenInWritten: Object.values(MALICIOUS),
			expectedLibSymbol: SERVER_SYM,
			expectedParentLibSymbol: PARENT_SYM,
			expectedKind: "sch",
		},
		{
			name: "client source stripped and replaced by server footprint",
			filePath: PCB_PATH,
			fileContent: SAMPLE_PCB,
			edits: [
				{
					op: "addFootprint",
					ref: "R1",
					libId: "Resistor_SMD:R_0603",
					value: "10k",
					x: 15,
					y: 25,
					...MALICIOUS,
				},
			],
			symMap: {},
			fpMap: { "Resistor_SMD:R_0603": { text: SERVER_FP } },
			expectOk: true,
			expectedInWritten: ["Resistor_SMD:R_0603"],
			forbiddenInWritten: Object.values(MALICIOUS),
			expectedKind: "pcb",
		},
		missingCase(
			"missing symbol libId fails call without writing files",
			SCH_PATH,
			SAMPLE_SCH,
			{ op: "addSymbol", ref: "R1", libId: "Missing:R", x: 10, y: 20 },
		),
		missingCase(
			"missing footprint libId fails call without writing files",
			PCB_PATH,
			SAMPLE_PCB,
			{
				op: "addFootprint",
				ref: "R1",
				libId: "Missing:FP",
				value: "10k",
				x: 10,
				y: 20,
			},
		),
	];

	for (const tc of TABLE_CASES) {
		test(tc.name, () => runResolveTestCase(tc));
	}
});
