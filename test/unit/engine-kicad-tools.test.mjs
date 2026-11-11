import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { isId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerKicadTools } from "../../backend/src/engine/tools/kicad-tools.js";

const VALID_SCH = "/abs/path/project/board.kicad_sch";
const VALID_PCB = "/abs/path/project/board.kicad_pcb";
const TEST_COMMIT = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9012";

const UUID_PART = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
const UUID_TRACE = "b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e";
const UUID_NET = "c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f";

const CANNED_ERC_VIOLATIONS = [
	{
		type: "pin_not_connected",
		severity: "error",
		description: "Pin not connected",
		items: [{ uuid: UUID_PART, description: "Symbol U1 pin 1" }],
	},
	{
		type: "lib_symbol_mismatch",
		severity: "warning",
		description: "Symbol does not match library",
		items: [{ uuid: UUID_PART, description: "Symbol R1" }],
	},
	{
		type: "info_annotation",
		severity: "info",
		description: "Informational note",
		items: [{ uuid: UUID_NET, description: "Net /RESET" }],
	},
	{
		type: "global_label_missing",
		severity: "unknown_level",
		description: "Global label missing connection",
		items: [{ description: "Unconnected label VCC" }],
	},
];

const CANNED_DRC_VIOLATIONS = [
	{
		type: "clearance",
		severity: "error",
		description: "Clearance violation",
		items: [
			{ uuid: UUID_PART, description: "Footprint C1 pad 1" },
			{ uuid: UUID_TRACE, description: "Track on F.Cu" },
		],
	},
	{
		type: "hole_near_hole",
		severity: "warning",
		description: "Via too close to via",
		items: [{ uuid: UUID_TRACE, description: "Via at (12.5, 30.0)" }],
	},
	{
		type: "empty_violation",
		severity: "warning",
		description: "Edge clearance warning without items",
		items: [],
	},
];

const CANNED_ERC_REPORT = {
	violations: CANNED_ERC_VIOLATIONS,
	summary: { errors: 1, warnings: 1 },
};

const CANNED_DRC_REPORT = {
	violations: CANNED_DRC_VIOLATIONS,
	summary: { errors: 1, warnings: 2 },
};

function createFakeCli(overrides = {}) {
	const runErcCalls = [];
	const runDrcCalls = [];
	const exportNetlistCalls = [];
	const recordCall = async (calls, args, error, defaultVal) => {
		calls.push(args);
		if (error) throw error;
		return defaultVal;
	};
	return {
		runErcCalls,
		runDrcCalls,
		exportNetlistCalls,
		runErc: (schPath, outJsonPath) =>
			recordCall(
				runErcCalls,
				{ schPath, outJsonPath },
				overrides.ercError,
				overrides.ercReport || CANNED_ERC_REPORT,
			),
		runDrc: (pcbPath, outJsonPath) =>
			recordCall(
				runDrcCalls,
				{ pcbPath, outJsonPath },
				overrides.drcError,
				overrides.drcReport || CANNED_DRC_REPORT,
			),
		exportNetlist: (schPath, outPath, format) =>
			recordCall(
				exportNetlistCalls,
				{ schPath, outPath, format },
				overrides.exportError,
				outPath,
			),
		version: async () => "fake-kicad-10.0.0",
	};
}

function setupRegistry(fakeCli, commit = TEST_COMMIT) {
	const registry = createRegistry();
	registerKicadTools(registry, { cli: fakeCli, commit });
	return registry;
}

function assertValidIssues(issues, expectedSource) {
	for (const issue of issues) {
		assert.equal(issue.source, expectedSource);
		assert.equal(issue.status, "open");
		assert.equal(isId(issue.id, "issue"), true);
		const validation = validateIssue(issue);
		assert.equal(
			validation.ok,
			true,
			`Issue invalid: ${validation.errors.join("; ")}`,
		);
	}
}

function assertToolExecution(opts) {
	const { res, call, expectedPath, summary, source } = opts;
	assert.equal(res.ok, true);
	assert.equal(call.schPath || call.pcbPath, expectedPath);
	assert.equal(path.dirname(call.outJsonPath), os.tmpdir());
	assert.deepEqual(res.output.summary, summary);
	assertValidIssues(res.output.issues, source);
}

function assertErcMappedIssues(issues) {
	const severities = issues.map((i) => i.severity);
	assert.deepEqual(severities, ["error", "warning", "info", "error"]);
	assert.deepEqual(
		[issues[0].itemIds[0], issues[2].itemIds[0]],
		[`part_${UUID_PART}`, `net_${UUID_NET}`],
	);
	assert.equal(isId(issues[3].itemIds[0], "part"), true);
	assert.match(issues[3].message, /Unconnected label VCC/);
}

async function callExportNetlist(params) {
	const cli = createFakeCli();
	const registry = setupRegistry(cli);
	const res = await registry.call("kicad.export_netlist", params);
	return { cli, res };
}

function assertExportNetlistCall(cli, res, format) {
	assert.equal(res.ok, true);
	assert.equal(cli.exportNetlistCalls[0].format, format);
}

describe("module contract", () => {
	test("exports match the contract exactly", async () => {
		const mod = await import("../../backend/src/engine/tools/kicad-tools.js");
		const exportedKeys = Object.keys(mod).sort();
		assert.deepEqual(exportedKeys, ["registerKicadTools"]);
	});
});

describe("tool registration and schema", () => {
	test("registers read tools kicad.erc, kicad.drc, kicad.export_netlist", () => {
		const registry = setupRegistry(createFakeCli());
		const tools = registry.list();
		assert.equal(tools.length, 3);
		const names = tools.map((t) => t.name).sort();
		assert.deepEqual(names, ["kicad.drc", "kicad.erc", "kicad.export_netlist"]);
		for (const tool of tools) {
			assert.equal(tool.permission, "read");
			assert.equal(typeof tool.description, "string");
			assert.equal(tool.description.length > 0, true);
		}
	});

	test("registers with default options when omitted", () => {
		const registry = createRegistry();
		registerKicadTools(registry);
		assert.equal(registry.list().length, 3);
	});
});

describe("kicad.erc tool execution", () => {
	test("runs ERC and converts violations to valid Issues", async () => {
		const cli = createFakeCli();
		const registry = setupRegistry(cli);
		const res = await registry.call("kicad.erc", { schPath: VALID_SCH });
		assertToolExecution({
			res,
			call: cli.runErcCalls[0],
			expectedPath: VALID_SCH,
			summary: { errors: 1, warnings: 1 },
			source: "erc",
		});
	});

	test("maps severity and item prefixes for ERC violations", async () => {
		const registry = setupRegistry(createFakeCli());
		const res = await registry.call("kicad.erc", { schPath: VALID_SCH });
		assert.equal(res.ok, true);
		assertErcMappedIssues(res.output.issues);
	});
});

describe("kicad.drc tool execution", () => {
	test("runs DRC and converts violations with footprint/track/via prefixes", async () => {
		const cli = createFakeCli();
		const registry = setupRegistry(cli);
		const res = await registry.call("kicad.drc", { pcbPath: VALID_PCB });
		assertToolExecution({
			res,
			call: cli.runDrcCalls[0],
			expectedPath: VALID_PCB,
			summary: { errors: 1, warnings: 2 },
			source: "drc",
		});
		assert.deepEqual(res.output.issues[0].itemIds, [
			`part_${UUID_PART}`,
			`trace_${UUID_TRACE}`,
		]);
		assert.equal(res.output.issues[1].itemIds[0], `trace_${UUID_TRACE}`);
		assert.equal(isId(res.output.issues[2].itemIds[0], "part"), true);
	});

	test("defaults commit to HEAD when omitted", async () => {
		const registry = createRegistry();
		registerKicadTools(registry, { cli: createFakeCli() });
		const res = await registry.call("kicad.drc", { pcbPath: VALID_PCB });
		assert.deepEqual(
			{ ok: res.ok, commit: res.output.issues[0].commit },
			{ ok: true, commit: "HEAD" },
		);
	});
});

describe("kicad.export_netlist tool execution", () => {
	test("exports netlist with default format kicadsexpr", async () => {
		const { cli, res } = await callExportNetlist({ schPath: VALID_SCH });
		assertExportNetlistCall(cli, res, "kicadsexpr");
		assert.equal(cli.exportNetlistCalls[0].schPath, VALID_SCH);
		assert.equal(path.dirname(res.output.netlistPath), os.tmpdir());
	});

	test("exports netlist with custom format parameter", async () => {
		const { cli, res } = await callExportNetlist({
			schPath: VALID_SCH,
			format: "spice",
		});
		assertExportNetlistCall(cli, res, "spice");
		assert.match(res.output.netlistPath, /\.cir$/);
	});
});

describe("input path validation via registry", () => {
	const REJECT_CASES = [
		{
			tool: "kicad.erc",
			callKey: "runErcCalls",
			label: "missing schPath",
			input: {},
		},
		{
			tool: "kicad.erc",
			callKey: "runErcCalls",
			label: "relative path",
			input: { schPath: "board.kicad_sch" },
		},
		{
			tool: "kicad.erc",
			callKey: "runErcCalls",
			label: "wrong extension",
			input: { schPath: "/abs/board.kicad_pcb" },
		},
		{
			tool: "kicad.erc",
			callKey: "runErcCalls",
			label: "suffix extension",
			input: { schPath: "/abs/board.kicad_sch.bak" },
		},
		{
			tool: "kicad.erc",
			callKey: "runErcCalls",
			label: "non-string schPath",
			input: { schPath: 999 },
		},
		{
			tool: "kicad.erc",
			callKey: "runErcCalls",
			label: "extra property",
			input: { schPath: VALID_SCH, extra: true },
		},
		{
			tool: "kicad.drc",
			callKey: "runDrcCalls",
			label: "missing pcbPath",
			input: {},
		},
		{
			tool: "kicad.drc",
			callKey: "runDrcCalls",
			label: "relative path",
			input: { pcbPath: "board.kicad_pcb" },
		},
		{
			tool: "kicad.drc",
			callKey: "runDrcCalls",
			label: "wrong extension",
			input: { pcbPath: "/abs/board.kicad_sch" },
		},
		{
			tool: "kicad.drc",
			callKey: "runDrcCalls",
			label: "suffix extension",
			input: { pcbPath: "/abs/board.kicad_pcb.tmp" },
		},
		{
			tool: "kicad.drc",
			callKey: "runDrcCalls",
			label: "non-string pcbPath",
			input: { pcbPath: false },
		},
		{
			tool: "kicad.drc",
			callKey: "runDrcCalls",
			label: "extra property",
			input: { pcbPath: VALID_PCB, foo: "bar" },
		},
		{
			tool: "kicad.export_netlist",
			callKey: "exportNetlistCalls",
			label: "missing schPath",
			input: {},
		},
		{
			tool: "kicad.export_netlist",
			callKey: "exportNetlistCalls",
			label: "relative path",
			input: { schPath: "test.kicad_sch" },
		},
		{
			tool: "kicad.export_netlist",
			callKey: "exportNetlistCalls",
			label: "non-string format",
			input: { schPath: VALID_SCH, format: 123 },
		},
	];

	for (const { tool, callKey, label, input } of REJECT_CASES) {
		test(`${tool} rejects ${label}`, async () => {
			const cli = createFakeCli();
			const registry = setupRegistry(cli);
			const res = await registry.call(tool, input);
			assert.deepEqual(
				{ ok: res.ok, callCount: cli[callKey].length },
				{ ok: false, callCount: 0 },
			);
		});
	}

	const GARBAGE_INPUTS = [null, undefined, "bad", 42, []];
	for (const garbage of GARBAGE_INPUTS) {
		test(`handles garbage input without throwing: ${String(garbage)}`, async () => {
			const registry = setupRegistry(createFakeCli());
			const res = await registry.call("kicad.erc", garbage);
			assert.equal(res.ok, false);
		});
	}
});

describe("error handling and cli failure", () => {
	const CLI_FAILURE_CASES = [
		{
			name: "returns error when CLI runErc fails",
			tool: "kicad.erc",
			input: { schPath: VALID_SCH },
			override: { ercError: new Error("ERC process killed") },
			expectedError: "ERC process killed",
		},
		{
			name: "returns error when CLI runDrc fails",
			tool: "kicad.drc",
			input: { pcbPath: VALID_PCB },
			override: { drcError: new Error("DRC failed") },
			expectedError: "DRC failed",
		},
		{
			name: "returns error when CLI exportNetlist fails",
			tool: "kicad.export_netlist",
			input: { schPath: VALID_SCH },
			override: { exportError: new Error("Netlist export crash") },
			expectedError: "Netlist export crash",
		},
	];

	for (const {
		name,
		tool,
		input,
		override,
		expectedError,
	} of CLI_FAILURE_CASES) {
		test(name, async () => {
			const cli = createFakeCli(override);
			const registry = setupRegistry(cli);
			const res = await registry.call(tool, input);
			assert.deepEqual(
				{ ok: res.ok, error: res.error },
				{ ok: false, error: expectedError },
			);
		});
	}
});
