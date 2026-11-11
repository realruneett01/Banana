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

function createCannedErcReport() {
	return {
		violations: CANNED_ERC_VIOLATIONS,
		summary: { errors: 1, warnings: 1 },
	};
}

function createCannedDrcReport() {
	return {
		violations: CANNED_DRC_VIOLATIONS,
		summary: { errors: 1, warnings: 2 },
	};
}

function createFakeCli(overrides = {}) {
	const runErcCalls = [];
	const runDrcCalls = [];
	const exportNetlistCalls = [];
	return {
		runErcCalls,
		runDrcCalls,
		exportNetlistCalls,
		async runErc(schPath, outJsonPath) {
			runErcCalls.push({ schPath, outJsonPath });
			if (overrides.ercError) throw overrides.ercError;
			return overrides.ercReport || createCannedErcReport();
		},
		async runDrc(pcbPath, outJsonPath) {
			runDrcCalls.push({ pcbPath, outJsonPath });
			if (overrides.drcError) throw overrides.drcError;
			return overrides.drcReport || createCannedDrcReport();
		},
		async exportNetlist(schPath, outPath, format) {
			exportNetlistCalls.push({ schPath, outPath, format });
			if (overrides.exportError) throw overrides.exportError;
			return outPath;
		},
		async version() {
			return "fake-kicad-10.0.0";
		},
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
		assert.equal(res.ok, true);
		assert.equal(cli.runErcCalls[0].schPath, VALID_SCH);
		assert.equal(path.dirname(cli.runErcCalls[0].outJsonPath), os.tmpdir());
		assert.deepEqual(res.output.summary, { errors: 1, warnings: 1 });
		assertValidIssues(res.output.issues, "erc");
	});

	test("maps severity and item prefixes for ERC violations", async () => {
		const registry = setupRegistry(createFakeCli());
		const res = await registry.call("kicad.erc", { schPath: VALID_SCH });
		assert.equal(res.ok, true);
		const { issues } = res.output;

		assert.equal(issues[0].severity, "error");
		assert.equal(issues[0].itemIds[0], `part_${UUID_PART}`);
		assert.equal(issues[1].severity, "warning");
		assert.equal(issues[2].severity, "info");
		assert.equal(issues[2].itemIds[0], `net_${UUID_NET}`);
		assert.equal(issues[3].severity, "error");
		assert.equal(isId(issues[3].itemIds[0], "part"), true);
		assert.match(issues[3].message, /Unconnected label VCC/);
	});
});

describe("kicad.drc tool execution", () => {
	test("runs DRC and converts violations with footprint/track/via prefixes", async () => {
		const cli = createFakeCli();
		const registry = setupRegistry(cli);
		const res = await registry.call("kicad.drc", { pcbPath: VALID_PCB });
		assert.equal(res.ok, true);
		assert.equal(cli.runDrcCalls[0].pcbPath, VALID_PCB);
		assert.equal(path.dirname(cli.runDrcCalls[0].outJsonPath), os.tmpdir());
		assert.deepEqual(res.output.summary, { errors: 1, warnings: 2 });
		assertValidIssues(res.output.issues, "drc");
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
		assert.equal(res.ok, true);
		assert.equal(res.output.issues[0].commit, "HEAD");
	});
});

describe("kicad.export_netlist tool execution", () => {
	test("exports netlist with default format kicadsexpr", async () => {
		const cli = createFakeCli();
		const registry = setupRegistry(cli);
		const res = await registry.call("kicad.export_netlist", {
			schPath: VALID_SCH,
		});
		assert.equal(res.ok, true);
		assert.equal(cli.exportNetlistCalls[0].schPath, VALID_SCH);
		assert.equal(cli.exportNetlistCalls[0].format, "kicadsexpr");
		assert.equal(path.dirname(res.output.netlistPath), os.tmpdir());
	});

	test("exports netlist with custom format parameter", async () => {
		const cli = createFakeCli();
		const registry = setupRegistry(cli);
		const res = await registry.call("kicad.export_netlist", {
			schPath: VALID_SCH,
			format: "spice",
		});
		assert.equal(res.ok, true);
		assert.equal(cli.exportNetlistCalls[0].format, "spice");
		assert.match(res.output.netlistPath, /\.cir$/);
	});
});

describe("input path validation via registry", () => {
	const BAD_ERC_INPUTS = [
		{ label: "missing schPath", input: {} },
		{ label: "relative path", input: { schPath: "board.kicad_sch" } },
		{ label: "wrong extension", input: { schPath: "/abs/board.kicad_pcb" } },
		{
			label: "suffix extension",
			input: { schPath: "/abs/board.kicad_sch.bak" },
		},
		{ label: "non-string schPath", input: { schPath: 999 } },
		{ label: "extra property", input: { schPath: VALID_SCH, extra: true } },
	];

	for (const { label, input } of BAD_ERC_INPUTS) {
		test(`kicad.erc rejects ${label}`, async () => {
			const cli = createFakeCli();
			const registry = setupRegistry(cli);
			const res = await registry.call("kicad.erc", input);
			assert.equal(res.ok, false);
			assert.equal(cli.runErcCalls.length, 0);
		});
	}

	const BAD_DRC_INPUTS = [
		{ label: "missing pcbPath", input: {} },
		{ label: "relative path", input: { pcbPath: "board.kicad_pcb" } },
		{ label: "wrong extension", input: { pcbPath: "/abs/board.kicad_sch" } },
		{
			label: "suffix extension",
			input: { pcbPath: "/abs/board.kicad_pcb.tmp" },
		},
		{ label: "non-string pcbPath", input: { pcbPath: false } },
		{ label: "extra property", input: { pcbPath: VALID_PCB, foo: "bar" } },
	];

	for (const { label, input } of BAD_DRC_INPUTS) {
		test(`kicad.drc rejects ${label}`, async () => {
			const cli = createFakeCli();
			const registry = setupRegistry(cli);
			const res = await registry.call("kicad.drc", input);
			assert.equal(res.ok, false);
			assert.equal(cli.runDrcCalls.length, 0);
		});
	}

	const BAD_NETLIST_INPUTS = [
		{ label: "missing schPath", input: {} },
		{ label: "relative path", input: { schPath: "test.kicad_sch" } },
		{ label: "non-string format", input: { schPath: VALID_SCH, format: 123 } },
	];

	for (const { label, input } of BAD_NETLIST_INPUTS) {
		test(`kicad.export_netlist rejects ${label}`, async () => {
			const cli = createFakeCli();
			const registry = setupRegistry(cli);
			const res = await registry.call("kicad.export_netlist", input);
			assert.equal(res.ok, false);
			assert.equal(cli.exportNetlistCalls.length, 0);
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
	test("returns error when CLI runErc fails", async () => {
		const cli = createFakeCli({ ercError: new Error("ERC process killed") });
		const registry = setupRegistry(cli);
		const res = await registry.call("kicad.erc", { schPath: VALID_SCH });
		assert.equal(res.ok, false);
		assert.equal(res.error, "ERC process killed");
	});

	test("returns error when CLI runDrc fails", async () => {
		const cli = createFakeCli({ drcError: new Error("DRC failed") });
		const registry = setupRegistry(cli);
		const res = await registry.call("kicad.drc", { pcbPath: VALID_PCB });
		assert.equal(res.ok, false);
		assert.equal(res.error, "DRC failed");
	});

	test("returns error when CLI exportNetlist fails", async () => {
		const cli = createFakeCli({
			exportError: new Error("Netlist export crash"),
		});
		const registry = setupRegistry(cli);
		const res = await registry.call("kicad.export_netlist", {
			schPath: VALID_SCH,
		});
		assert.equal(res.ok, false);
		assert.equal(res.error, "Netlist export crash");
	});
});
