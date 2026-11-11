import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerDiffTools } from "../../backend/src/engine/tools/diff-tools.js";

const VALID_PCB_BASE = "/abs/path/project/board_base.kicad_pcb";
const VALID_PCB_TARGET = "/abs/path/project/board_target.kicad_pcb";
const VALID_SCH_BASE = "/abs/path/project/schematic_base.kicad_sch";
const VALID_SCH_TARGET = "/abs/path/project/schematic_target.kicad_sch";
const VALID_WIN_BASE = "C:/projects/board_base.kicad_pcb";
const VALID_WIN_TARGET = "C:\\projects\\board_target.kicad_pcb";

const PCB_PAIR = { basePath: VALID_PCB_BASE, targetPath: VALID_PCB_TARGET };
const SCH_PAIR = { basePath: VALID_SCH_BASE, targetPath: VALID_SCH_TARGET };
const WIN_PAIR = { basePath: VALID_WIN_BASE, targetPath: VALID_WIN_TARGET };

function setupRegistryWithFake(
	fakeRunDiff = async () => ({ modifications: [] }),
) {
	const registry = createRegistry();
	registerDiffTools(registry, { runDiff: fakeRunDiff });
	return registry;
}

async function callDiffTool(input, fakeRunDiff) {
	const registry = setupRegistryWithFake(fakeRunDiff);
	return registry.call("diff.compare_files", input);
}

function assertToolMetadata(tool) {
	assert.deepEqual(
		{
			name: tool.name,
			permission: tool.permission,
			hasDescription:
				typeof tool.description === "string" && tool.description.length > 0,
		},
		{
			name: "diff.compare_files",
			permission: "read",
			hasDescription: true,
		},
	);
}

function assertInputSchema(schema) {
	assert.deepEqual(
		{
			type: schema.type,
			required: schema.required,
			basePathType: schema.properties.basePath.type,
			targetPathType: schema.properties.targetPath.type,
			isPcbType: schema.properties.isPcb.type,
		},
		{
			type: "object",
			required: ["basePath", "targetPath"],
			basePathType: "string",
			targetPathType: "string",
			isPcbType: "boolean",
		},
	);
}

function assertCallCase(res, capturedArgs, tc) {
	assert.equal(res.ok, true);
	if (tc.expectedOutput) {
		assert.deepEqual(res.output, tc.expectedOutput);
	}
	if (tc.expectedCapturedArgs) {
		assert.deepEqual(capturedArgs, tc.expectedCapturedArgs);
	}
	if (tc.expectedIsPcb !== undefined) {
		assert.equal(capturedArgs.isPcb, tc.expectedIsPcb);
	}
}

function assertErrorCase(res, tc) {
	assert.equal(res.ok, false);
	if (tc.expectedPattern) {
		assert.match(res.error, tc.expectedPattern);
	} else {
		assert.equal(res.error, tc.expectedError);
	}
}

describe("module contract", () => {
	test("exports match the contract exactly", async () => {
		const mod = await import("../../backend/src/engine/tools/diff-tools.js");
		const exportedKeys = Object.keys(mod).sort();
		assert.deepEqual(exportedKeys, ["registerDiffTools"]);
	});
});

describe("tool registration and schema", () => {
	test("registers read-only tool diff.compare_files", () => {
		const registry = setupRegistryWithFake();
		const tools = registry.list();
		assert.equal(tools.length, 1);
		assertToolMetadata(tools[0]);
	});

	test("input schema requires basePath and targetPath", () => {
		const registry = setupRegistryWithFake();
		const [tool] = registry.list();
		assertInputSchema(tool.inputSchema);
	});

	test("registers successfully with default deps when deps omitted", () => {
		const registry = createRegistry();
		registerDiffTools(registry);
		assert.equal(registry.list().length, 1);
		assert.equal(registry.list()[0].name, "diff.compare_files");
	});
});

describe("call execution with fake runDiff", () => {
	const FAKE_PCB_RESULT = {
		modifications: [{ type: "add", id: "mod_1" }],
		pcbMetadata: { padCount: 42 },
		telemetry: { tDiff: 15.2 },
	};
	const EMPTY_DIFF_RESULT = { modifications: [] };
	const NULL_METADATA_RESULT = { modifications: [], pcbMetadata: null };

	const CALL_CASES = [
		{
			name: "executes PCB diff and infers isPcb=true from .kicad_pcb",
			input: PCB_PAIR,
			result: FAKE_PCB_RESULT,
			expectedOutput: FAKE_PCB_RESULT,
			expectedCapturedArgs: { ...PCB_PAIR, isPcb: true },
		},
		{
			name: "executes schematic diff and infers isPcb=false from .kicad_sch",
			input: SCH_PAIR,
			result: EMPTY_DIFF_RESULT,
			expectedOutput: EMPTY_DIFF_RESULT,
			expectedIsPcb: false,
		},
		{
			name: "respects explicit isPcb override",
			input: { ...PCB_PAIR, isPcb: false },
			result: EMPTY_DIFF_RESULT,
			expectedIsPcb: false,
		},
		{
			name: "accepts Windows absolute paths with drive letters and backslashes",
			input: WIN_PAIR,
			result: EMPTY_DIFF_RESULT,
		},
		{
			name: "accepts output with null pcbMetadata",
			input: SCH_PAIR,
			result: NULL_METADATA_RESULT,
			expectedOutput: NULL_METADATA_RESULT,
		},
	];

	for (const tc of CALL_CASES) {
		test(tc.name, async () => {
			let capturedArgs = null;
			const res = await callDiffTool(tc.input, async (args) => {
				capturedArgs = args;
				return tc.result;
			});
			assertCallCase(res, capturedArgs, tc);
		});
	}
});

const BAD_INPUT_SPECS = [
	["missing basePath", { targetPath: VALID_PCB_TARGET }],
	["missing targetPath", { basePath: VALID_PCB_BASE }],
	[
		"relative basePath without leading slash",
		{ basePath: "board.kicad_pcb", targetPath: VALID_PCB_TARGET },
	],
	[
		"relative basePath with dot-slash",
		{ basePath: "./board.kicad_pcb", targetPath: VALID_PCB_TARGET },
	],
	[
		"relative basePath with dot-dot",
		{ basePath: "../board.kicad_pcb", targetPath: VALID_PCB_TARGET },
	],
	[
		"basePath ending in wrong extension",
		{ basePath: "/abs/board.txt", targetPath: VALID_PCB_TARGET },
	],
	[
		"targetPath ending in wrong extension",
		{ basePath: VALID_PCB_BASE, targetPath: "/abs/board.kicad_pro" },
	],
	[
		"basePath ending with extra extension suffix",
		{ basePath: "/abs/board.kicad_pcb.bak", targetPath: VALID_PCB_TARGET },
	],
	["non-string basePath", { basePath: 12345, targetPath: VALID_PCB_TARGET }],
	["non-boolean isPcb", { ...PCB_PAIR, isPcb: "true" }],
	["unexpected extra property", { ...PCB_PAIR, unknownKey: "value" }],
];

describe("input validation rejects invalid paths and shapes", () => {
	const BAD_INPUT_CASES = BAD_INPUT_SPECS.map(([label, input]) => ({
		label,
		input,
	}));

	for (const { label, input } of BAD_INPUT_CASES) {
		test(`rejects ${label}`, async () => {
			let called = false;
			const res = await callDiffTool(input, async () => {
				called = true;
				return { modifications: [] };
			});
			assert.deepEqual(
				{ ok: res.ok, isErrorString: typeof res.error === "string", called },
				{ ok: false, isErrorString: true, called: false },
			);
		});
	}

	const GARBAGE_INPUTS = [null, undefined, 42, "not-an-object", true, []];
	for (const garbage of GARBAGE_INPUTS) {
		test(`handles garbage input without throwing: ${String(garbage)}`, async () => {
			assert.doesNotThrow(async () => {
				const res = await callDiffTool(garbage);
				assert.equal(res.ok, false);
			});
		});
	}
});

describe("error handling", () => {
	const ERROR_CASES = [
		{
			name: "returns ok:false on async runDiff rejection",
			runDiff: async () => {
				throw new Error("KiCad CLI diff crashed");
			},
			expectedError: "KiCad CLI diff crashed",
		},
		{
			name: "returns ok:false on synchronous runDiff throw",
			runDiff: () => {
				throw new Error("Synchronous diff setup error");
			},
			expectedError: "Synchronous diff setup error",
		},
		{
			name: "returns ok:false when runDiff output violates outputSchema",
			runDiff: async () => ({
				invalidField: "no-modifications",
			}),
			expectedPattern: /\$\.modifications: missing/,
		},
	];

	for (const tc of ERROR_CASES) {
		test(tc.name, async () => {
			const res = await callDiffTool(PCB_PAIR, tc.runDiff);
			assertErrorCase(res, tc);
		});
	}
});
