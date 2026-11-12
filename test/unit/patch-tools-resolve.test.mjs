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
	const readFile = async (p) => {
		if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
		return files.get(p);
	};
	const writeFile = async (p, data) => {
		written.set(p, data);
	};
	return { files, written, fsImpl: { readFile, writeFile } };
}

function createFakeExecFile() {
	const calls = [];
	const execFileFn = async (cmd, args, opts) => {
		calls.push({ cmd, args, opts });
		if (args.includes("--is-inside-work-tree")) {
			return { stdout: "true\n" };
		}
		if (args.includes("HEAD")) {
			return { stdout: `${COMMIT_HASH}\n` };
		}
		return { stdout: "" };
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

function assertFailure(res, fakeFs, fakeExec, expectedError) {
	assert.equal(res.ok, false);
	assert.equal(res.error, expectedError);
	assert.equal(fakeFs.written.size, 0);
	const gitWrites = fakeExec.calls.filter(
		(c) => c.args.includes("add") || c.args.includes("commit"),
	);
	assert.equal(gitWrites.length, 0);
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

describe("patch-tools library resolution", () => {
	const TABLE_CASES = [
		{
			name: "client libSymbol stripped and replaced by server symbol",
			filePath: "hw/board.kicad_sch",
			fileContent: SAMPLE_SCH,
			edits: [
				{
					op: "addSymbol",
					ref: "R1",
					libId: "Device:R",
					x: 10,
					y: 20,
					libSymbol: "MALICIOUS_CLIENT_SYM",
					source: "MALICIOUS_CLIENT_SRC",
				},
			],
			symMap: { "Device:R": { text: SERVER_SYM, parentText: PARENT_SYM } },
			fpMap: {},
			expectOk: true,
			expectedInWritten: ['symbol "Device:R"'],
			forbiddenInWritten: ["MALICIOUS_CLIENT_SYM", "MALICIOUS_CLIENT_SRC"],
			expectedLibSymbol: SERVER_SYM,
			expectedParentLibSymbol: PARENT_SYM,
			expectedKind: "sch",
		},
		{
			name: "client source stripped and replaced by server footprint",
			filePath: "hw/board.kicad_pcb",
			fileContent: SAMPLE_PCB,
			edits: [
				{
					op: "addFootprint",
					ref: "R1",
					libId: "Resistor_SMD:R_0603",
					value: "10k",
					x: 15,
					y: 25,
					source: "MALICIOUS_CLIENT_SRC",
					libSymbol: "MALICIOUS_CLIENT_SYM",
				},
			],
			symMap: {},
			fpMap: { "Resistor_SMD:R_0603": { text: SERVER_FP } },
			expectOk: true,
			expectedInWritten: ["Resistor_SMD:R_0603"],
			forbiddenInWritten: ["MALICIOUS_CLIENT_SRC", "MALICIOUS_CLIENT_SYM"],
			expectedParentLibSymbol: undefined,
			expectedKind: "pcb",
		},
		{
			name: "missing symbol libId fails call without writing files",
			filePath: "hw/board.kicad_sch",
			fileContent: SAMPLE_SCH,
			edits: [{ op: "addSymbol", ref: "R1", libId: "Missing:R", x: 10, y: 20 }],
			symMap: {},
			fpMap: {},
			expectOk: false,
			expectedError: "Library item not found: Missing:R",
		},
		{
			name: "missing footprint libId fails call without writing files",
			filePath: "hw/board.kicad_pcb",
			fileContent: SAMPLE_PCB,
			edits: [
				{
					op: "addFootprint",
					ref: "R1",
					libId: "Missing:FP",
					value: "10k",
					x: 10,
					y: 20,
				},
			],
			symMap: {},
			fpMap: {},
			expectOk: false,
			expectedError: "Library item not found: Missing:FP",
		},
	];

	for (const tc of TABLE_CASES) {
		test(tc.name, () => runResolveTestCase(tc));
	}
});
