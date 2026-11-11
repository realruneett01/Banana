import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { parse } from "../../backend/src/engine/sexpr.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerDesignTools } from "../../backend/src/engine/tools/design-tools.js";

const TEST_COMMIT = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9012";

const DEFAULT_PART_DATA = Object.freeze({
	ref: "R1",
	value: "10k",
	symbol: "Device:R",
	footprint: "Resistor_SMD:R_0603_1608Metric",
});

function makePart(overrides = {}) {
	return Object.assign(
		{ id: newId("part"), props: {} },
		DEFAULT_PART_DATA,
		overrides,
	);
}

function makeCleanIR(partOverrides = {}) {
	const parts = ["R1", "R2"].map((ref) =>
		makePart({ ref, ...(ref === "R1" ? partOverrides : {}) }),
	);
	const linkNet = (name, pin) => ({
		id: newId("net"),
		name,
		pins: parts.map((p) => ({ partId: p.id, pin })),
	});
	return {
		schemaVersion: 1,
		name: "TestDesign",
		parts,
		nets: [linkNet("VCC", "1"), linkNet("GND", "2")],
		constraints: [
			{ id: "c1", kind: "rail", target: "VCC", value: 3.3, unit: "V" },
		],
	};
}

function makeEnv(overrides = {}) {
	const tempRange = (min, max) => ({ min, max });
	return Object.assign(
		{
			id: newId("env"),
			name: "LabEnv",
			ambientC: tempRange(20, 25),
			humidityPct: tempRange(40, 60),
			altitudeM: 100,
		},
		overrides,
	);
}

function makeThermalIR() {
	const thermalProps = { powerW: 2.0, thetaJA: 50, tjMaxC: 125 };
	const part = makePart({
		ref: "U1",
		value: "LDO",
		symbol: "Reg:LDO",
		footprint: "Pkg:SOT-223",
		props: thermalProps,
	});
	return { parts: [part] };
}

function makeFaultyIR() {
	return {
		schemaVersion: 1,
		name: "FaultyBoard",
		parts: [makePart({ ref: "U1", footprint: "" })],
		nets: [],
		constraints: [],
	};
}

async function invokeTool(tool, input, deps) {
	const registry = createRegistry();
	registerDesignTools(registry, deps);
	return registry.call(tool, input);
}

async function invokeSimRun(options = {}, deps) {
	const { env = makeEnv(), inputs = {}, kind = "thermal" } = options;
	return invokeTool(
		"sim.run",
		{ kind, env, commit: TEST_COMMIT, inputs },
		deps,
	);
}

function assertSuccess(res) {
	assert.equal(res.ok, true);
	return res.output;
}

function assertFailure(res, expectedError) {
	assert.equal(res.ok, false);
	if (typeof expectedError === "string") {
		assert.equal(res.error, expectedError);
		return;
	}
	if (expectedError instanceof RegExp) {
		assert.match(res.error, expectedError);
		return;
	}
	assert.equal(typeof res.error, "string");
}

function assertNonEmptyArray(arr) {
	assert.ok(Array.isArray(arr) && arr.length > 0);
}

function assertToolMetadata(tool) {
	assert.equal(tool.permission, "read");
	assert.ok(
		typeof tool.description === "string" && tool.description.length > 0,
	);
}

function assertValidationSuccess(res) {
	assert.deepEqual(assertSuccess(res), { valid: true, errors: [] });
}

function assertValidationFailure(res) {
	const out = assertSuccess(res);
	assert.equal(out.valid, false);
	assertNonEmptyArray(out.errors);
}

function assertInjectedCalled(res, called) {
	assertSuccess(res);
	assert.equal(called, true);
}

function assertZeroIssues(res) {
	assert.deepEqual(assertSuccess(res).issues, []);
}

function assertDetectedIssues(res) {
	assertNonEmptyArray(assertSuccess(res).issues);
}

function assertMockIssueResult(res, expectedId) {
	const { issues } = assertSuccess(res);
	assert.deepEqual([issues.length, issues[0]?.id], [1, expectedId]);
}

function assertAutoPlaceSuccess(res) {
	const { placed, ir } = assertSuccess(res);
	assert.equal(Array.isArray(placed) && placed.length, 2);
	assert.ok(ir.parts[0]?.placement && ir.parts[1]?.placement);
}

function assertMockPlacedResult(res, expectedPlaced) {
	assert.deepEqual(assertSuccess(res).placed, expectedPlaced);
}

function assertValidSexprDoc(res, rootSym) {
	const { text, warnings } = assertSuccess(res);
	assert.equal(typeof text, "string");
	assert.ok(Array.isArray(warnings));
	const parsed = parse(text);
	assert.equal(parsed?.[0]?.sym, rootSym);
}

function assertInvalidIr(res) {
	assertFailure(res, /Invalid circuit IR/i);
}

async function checkInvalidIrReported(tool, extra = {}) {
	const res = await invokeTool(tool, { ir: { schemaVersion: 999 }, ...extra });
	assertInvalidIr(res);
}

function assertThermalRunSuccess(res) {
	const { run, issues } = assertSuccess(res);
	assert.deepEqual([run.status, run.kind], ["done", "thermal"]);
	assert.ok(Array.isArray(issues));
}

function assertSimulationFailedOutput(res) {
	const { run, error } = assertSuccess(res);
	assert.deepEqual(
		{ status: run?.status, hasError: Boolean(error && /.+/.test(error)) },
		{ status: "failed", hasError: true },
	);
}

describe("engine-design-tools registration", () => {
	test("exports registerDesignTools function", () => {
		assert.equal(typeof registerDesignTools, "function");
	});

	test("registers all six tools with permission read", () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const tools = registry.list();
		assert.equal(tools.length, 6);
		assert.deepEqual(tools.map((t) => t.name).sort(), [
			"erc.run",
			"ir.auto_place",
			"ir.to_kicad_pcb",
			"ir.to_kicad_sch",
			"ir.validate",
			"sim.run",
		]);
		for (const tool of tools) {
			assertToolMetadata(tool);
		}
	});
});

describe("ir.validate tool", () => {
	test("returns valid:true and empty errors on valid IR", async () => {
		const res = await invokeTool("ir.validate", { ir: makeCleanIR() });
		assertValidationSuccess(res);
	});

	test("returns valid:false and errors array on invalid IR", async () => {
		const res = await invokeTool("ir.validate", {
			ir: { schemaVersion: 999, name: "Broken" },
		});
		assertValidationFailure(res);
	});

	test("supports injected deps.validateCircuitIR", async () => {
		let injectedCalled = false;
		const res = await invokeTool(
			"ir.validate",
			{ ir: {} },
			{
				validateCircuitIR: () => {
					injectedCalled = true;
					return { ok: true, errors: [] };
				},
			},
		);
		assertInjectedCalled(res, injectedCalled);
	});
});

describe("erc.run tool", () => {
	test("returns zero issues for clean IR", async () => {
		const res = await invokeTool("erc.run", {
			ir: makeCleanIR(),
			commit: TEST_COMMIT,
		});
		assertZeroIssues(res);
	});

	test("returns detected issues for faulty IR", async () => {
		const res = await invokeTool("erc.run", {
			ir: makeFaultyIR(),
			commit: TEST_COMMIT,
		});
		assertDetectedIssues(res);
	});

	test("supports injected deps.runErc", async () => {
		const res = await invokeTool(
			"erc.run",
			{ ir: {}, commit: "test" },
			{
				runErc: () => [{ id: "mock_issue", severity: "warning" }],
			},
		);
		assertMockIssueResult(res, "mock_issue");
	});
});

describe("ir.auto_place tool", () => {
	test("returns placed component IDs and updated IR", async () => {
		const res = await invokeTool("ir.auto_place", {
			ir: makeCleanIR(),
			boardW: 100,
			boardH: 80,
			gridMm: 2.54,
			marginMm: 5,
		});
		assertAutoPlaceSuccess(res);
	});

	test("reports error when board is too small", async () => {
		const res = await invokeTool("ir.auto_place", {
			ir: makeCleanIR(),
			boardW: 1,
			boardH: 1,
		});
		assertFailure(res, /board too small/i);
	});

	test("supports injected deps.autoPlace", async () => {
		const res = await invokeTool(
			"ir.auto_place",
			{ ir: {}, boardW: 50, boardH: 50 },
			{
				autoPlace: () => ({ ir: { mock: true }, placed: ["p1"] }),
			},
		);
		assertMockPlacedResult(res, ["p1"]);
	});
});

describe("ir.to_kicad_sch tool", () => {
	test("returns schematic text accepted by sexpr parse", async () => {
		const res = await invokeTool("ir.to_kicad_sch", {
			ir: makeCleanIR(),
			title: "Custom Schematic",
		});
		assertValidSexprDoc(res, "kicad_sch");
	});

	test("reports engine error on invalid IR", async () => {
		await checkInvalidIrReported("ir.to_kicad_sch");
	});
});

describe("ir.to_kicad_pcb tool", () => {
	test("returns pcb text accepted by sexpr parse", async () => {
		const ir = makeCleanIR({
			placement: { x: 20, y: 20, rot: 0, side: "F" },
		});
		const res = await invokeTool("ir.to_kicad_pcb", {
			ir,
			boardW: 80,
			boardH: 60,
		});
		assertValidSexprDoc(res, "kicad_pcb");
	});

	test("reports engine error on invalid IR", async () => {
		await checkInvalidIrReported("ir.to_kicad_pcb", {
			boardW: 50,
			boardH: 50,
		});
	});
});

describe("sim.run tool", () => {
	test("runs thermal simulation end-to-end", async () => {
		const res = await invokeSimRun({ inputs: { ir: makeThermalIR() } });
		assertThermalRunSuccess(res);
	});

	test("captures simulation error in output when env is invalid", async () => {
		const invalidEnv = makeEnv({ ambientC: { min: 40, max: 10 } });
		const res = await invokeSimRun({ env: invalidEnv });
		assertSimulationFailedOutput(res);
	});

	test("returns ok:false when handler throws or rejects", async () => {
		const crashDeps = {
			runSimulation: async () => {
				throw new Error("Simulation crash");
			},
		};
		const res = await invokeSimRun({}, crashDeps);
		assertFailure(res, "Simulation crash");
	});
});

describe("input validation errors", () => {
	const REJECT_CASES = [
		["ir.validate", {}, "missing ir"],
		["erc.run", { ir: {} }, "missing commit"],
		["erc.run", { commit: "abc" }, "missing ir"],
		["ir.auto_place", { ir: {} }, "missing boardW, boardH"],
		["ir.auto_place", { ir: {}, boardW: 50 }, "missing boardH"],
		["ir.to_kicad_sch", {}, "missing ir"],
		["ir.to_kicad_pcb", { ir: {} }, "missing boardW, boardH"],
		["sim.run", {}, "missing required sim fields"],
		[
			"sim.run",
			{ kind: "invalid-kind", env: {}, commit: "abc", inputs: {} },
			"invalid kind enum",
		],
		[
			"ir.validate",
			{ ir: {}, extraField: true },
			"extra property on additionalProperties: false",
		],
	];

	for (const [tool, input, label] of REJECT_CASES) {
		test(`${tool} rejects input: ${label}`, async () => {
			const res = await invokeTool(tool, input);
			assertFailure(res);
		});
	}
});
