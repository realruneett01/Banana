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

const makeReport = (rows, errors, warnings) => ({
	violations: rows.map(([type, severity, description, items]) => ({
		type,
		severity,
		description,
		items,
	})),
	summary: { errors, warnings },
});

const CANNED_ERC_REPORT = makeReport(
	[
		[
			"pin_not_connected",
			"error",
			"Pin not connected",
			[{ uuid: UUID_PART, description: "Symbol U1 pin 1" }],
		],
		[
			"lib_symbol_mismatch",
			"warning",
			"Symbol does not match library",
			[{ uuid: UUID_PART, description: "Symbol R1" }],
		],
		[
			"info_annotation",
			"info",
			"Informational note",
			[{ uuid: UUID_NET, description: "Net /RESET" }],
		],
		[
			"global_label_missing",
			"unknown_level",
			"Global label missing connection",
			[{ description: "Unconnected label VCC" }],
		],
	],
	1,
	1,
);

const CANNED_DRC_REPORT = makeReport(
	[
		[
			"clearance",
			"error",
			"Clearance violation",
			[
				{ uuid: UUID_PART, description: "Footprint C1 pad 1" },
				{ uuid: UUID_TRACE, description: "Track on F.Cu" },
			],
		],
		[
			"hole_near_hole",
			"warning",
			"Via too close to via",
			[{ uuid: UUID_TRACE, description: "Via at (12.5, 30.0)" }],
		],
		["empty_violation", "warning", "Edge clearance warning without items", []],
	],
	1,
	2,
);

function createFakeCli(overrides = {}) {
	const runErcCalls = [];
	const runDrcCalls = [];
	const exportNetlistCalls = [];
	const recordCall = async (calls, args, error, defaultVal) => {
		calls.push(args);
		if (error) throw error;
		return defaultVal;
	};
	const makeRunner = (bucket, key, err, rep) => (filePath, outJsonPath) =>
		recordCall(bucket, { [key]: filePath, outJsonPath }, err, rep);

	return {
		runErcCalls,
		runDrcCalls,
		exportNetlistCalls,
		runErc: makeRunner(
			runErcCalls,
			"schPath",
			overrides.ercError,
			overrides.ercReport || CANNED_ERC_REPORT,
		),
		runDrc: makeRunner(
			runDrcCalls,
			"pcbPath",
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

async function executeTool(tool, params, cli = createFakeCli()) {
	const registry = setupRegistry(cli);
	const res = await registry.call(tool, params);
	return { cli, res };
}

function assertValidIssues(issues, expectedSource) {
	for (const issue of issues) {
		const validation = validateIssue(issue);
		assert.deepEqual(
			{
				source: issue.source,
				status: issue.status,
				hasIssueId: isId(issue.id, "issue"),
				valid: validation.ok,
			},
			{
				source: expectedSource,
				status: "open",
				hasIssueId: true,
				valid: true,
			},
			validation.ok
				? undefined
				: `Issue invalid: ${validation.errors.join("; ")}`,
		);
	}
}

function assertToolExecution(opts) {
	const { res, call, expectedPath, summary, source } = opts;
	assert.deepEqual(
		{
			ok: res.ok,
			targetPath: call.schPath || call.pcbPath,
			tmpDir: path.dirname(call.outJsonPath),
			summary: res.output.summary,
		},
		{
			ok: true,
			targetPath: expectedPath,
			tmpDir: os.tmpdir(),
			summary,
		},
	);
	assertValidIssues(res.output.issues, source);
}

function assertErcMappedIssues(res) {
	const issues = res.output.issues;
	assert.deepEqual(
		{
			ok: res.ok,
			severities: issues.map((i) => i.severity),
			mappedIds: [issues[0].itemIds[0], issues[2].itemIds[0]],
			fallbackPartId: isId(issues[3].itemIds[0], "part"),
			matchesLabel: /Unconnected label VCC/.test(issues[3].message),
		},
		{
			ok: true,
			severities: ["error", "warning", "info", "error"],
			mappedIds: [`part_${UUID_PART}`, `net_${UUID_NET}`],
			fallbackPartId: true,
			matchesLabel: true,
		},
	);
}

function assertDrcMappedIssues(issues) {
	assert.deepEqual(
		{
			firstItemIds: issues[0].itemIds,
			secondLeadId: issues[1].itemIds[0],
			thirdIsPart: isId(issues[2].itemIds[0], "part"),
		},
		{
			firstItemIds: [`part_${UUID_PART}`, `trace_${UUID_TRACE}`],
			secondLeadId: `trace_${UUID_TRACE}`,
			thirdIsPart: true,
		},
	);
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
		assert.deepEqual(
			{
				count: tools.length,
				names: tools.map((t) => t.name).sort(),
				allRead: tools.every((t) => t.permission === "read"),
				allDescribed: tools.every(
					(t) => typeof t.description === "string" && t.description.length > 0,
				),
			},
			{
				count: 3,
				names: ["kicad.drc", "kicad.erc", "kicad.export_netlist"],
				allRead: true,
				allDescribed: true,
			},
		);
	});

	test("registers with default options when omitted", () => {
		const registry = createRegistry();
		registerKicadTools(registry);
		assert.equal(registry.list().length, 3);
	});
});

describe("kicad.erc tool execution", () => {
	test("runs ERC and converts violations to valid Issues", async () => {
		const { cli, res } = await executeTool("kicad.erc", { schPath: VALID_SCH });
		assertToolExecution({
			res,
			call: cli.runErcCalls[0],
			expectedPath: VALID_SCH,
			summary: { errors: 1, warnings: 1 },
			source: "erc",
		});
	});

	test("maps severity and item prefixes for ERC violations", async () => {
		const { res } = await executeTool("kicad.erc", { schPath: VALID_SCH });
		assertErcMappedIssues(res);
	});
});

describe("kicad.drc tool execution", () => {
	test("runs DRC and converts violations with footprint/track/via prefixes", async () => {
		const { cli, res } = await executeTool("kicad.drc", { pcbPath: VALID_PCB });
		assertToolExecution({
			res,
			call: cli.runDrcCalls[0],
			expectedPath: VALID_PCB,
			summary: { errors: 1, warnings: 2 },
			source: "drc",
		});
		assertDrcMappedIssues(res.output.issues);
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
		const { cli, res } = await executeTool("kicad.export_netlist", {
			schPath: VALID_SCH,
		});
		assert.deepEqual(
			{
				ok: res.ok,
				format: cli.exportNetlistCalls[0].format,
				schPath: cli.exportNetlistCalls[0].schPath,
				tmpDir: path.dirname(res.output.netlistPath),
			},
			{
				ok: true,
				format: "kicadsexpr",
				schPath: VALID_SCH,
				tmpDir: os.tmpdir(),
			},
		);
	});

	test("exports netlist with custom format parameter", async () => {
		const { cli, res } = await executeTool("kicad.export_netlist", {
			schPath: VALID_SCH,
			format: "spice",
		});
		assert.deepEqual(
			{
				ok: res.ok,
				format: cli.exportNetlistCalls[0].format,
				hasCirExtension: /\.cir$/.test(res.output.netlistPath),
			},
			{
				ok: true,
				format: "spice",
				hasCirExtension: true,
			},
		);
	});
});

describe("input path validation via registry", () => {
	const buildFileRejections = (opts) => [
		[`missing ${opts.key}`, {}],
		["relative path", { [opts.key]: `board.${opts.ext}` }],
		["wrong extension", { [opts.key]: `/abs/board.${opts.wrongExt}` }],
		[
			"suffix extension",
			{ [opts.key]: `/abs/board.${opts.ext}.${opts.suffix}` },
		],
		[`non-string ${opts.key}`, { [opts.key]: opts.badVal }],
		[
			"extra property",
			{ [opts.key]: opts.validPath, [opts.extraKey]: opts.extraVal },
		],
	];

	const makeRejections = (tool, callKey, cases) =>
		cases.map(([label, input]) => ({ tool, callKey, label, input }));

	const REJECT_CASES = [
		...makeRejections(
			"kicad.erc",
			"runErcCalls",
			buildFileRejections({
				key: "schPath",
				ext: "kicad_sch",
				wrongExt: "kicad_pcb",
				suffix: "bak",
				badVal: 999,
				validPath: VALID_SCH,
				extraKey: "extra",
				extraVal: true,
			}),
		),
		...makeRejections(
			"kicad.drc",
			"runDrcCalls",
			buildFileRejections({
				key: "pcbPath",
				ext: "kicad_pcb",
				wrongExt: "kicad_sch",
				suffix: "tmp",
				badVal: false,
				validPath: VALID_PCB,
				extraKey: "foo",
				extraVal: "bar",
			}),
		),
		...makeRejections("kicad.export_netlist", "exportNetlistCalls", [
			["missing schPath", {}],
			["relative path", { schPath: "test.kicad_sch" }],
			["non-string format", { schPath: VALID_SCH, format: 123 }],
		]),
	];

	for (const { tool, callKey, label, input } of REJECT_CASES) {
		test(`${tool} rejects ${label}`, async () => {
			const { cli, res } = await executeTool(tool, input);
			assert.deepEqual(
				{ ok: res.ok, callCount: cli[callKey].length },
				{ ok: false, callCount: 0 },
			);
		});
	}

	const GARBAGE_INPUTS = [null, undefined, "bad", 42, []];
	for (const garbage of GARBAGE_INPUTS) {
		test(`handles garbage input without throwing: ${String(garbage)}`, async () => {
			const { res } = await executeTool("kicad.erc", garbage);
			assert.equal(res.ok, false);
		});
	}
});

describe("error handling and cli failure", () => {
	const CLI_FAILURE_CASES = [
		[
			"returns error when CLI runErc fails",
			"kicad.erc",
			{ schPath: VALID_SCH },
			"ercError",
			"ERC process killed",
		],
		[
			"returns error when CLI runDrc fails",
			"kicad.drc",
			{ pcbPath: VALID_PCB },
			"drcError",
			"DRC failed",
		],
		[
			"returns error when CLI exportNetlist fails",
			"kicad.export_netlist",
			{ schPath: VALID_SCH },
			"exportError",
			"Netlist export crash",
		],
	].map(([name, tool, input, errKey, expectedError]) => ({
		name,
		tool,
		input,
		override: { [errKey]: new Error(expectedError) },
		expectedError,
	}));

	for (const {
		name,
		tool,
		input,
		override,
		expectedError,
	} of CLI_FAILURE_CASES) {
		test(name, async () => {
			const { res } = await executeTool(tool, input, createFakeCli(override));
			assert.deepEqual(
				{ ok: res.ok, error: res.error },
				{ ok: false, error: expectedError },
			);
		});
	}
});
