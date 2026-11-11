import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { parse } from "../../backend/src/engine/sexpr.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerDesignTools } from "../../backend/src/engine/tools/design-tools.js";

const TEST_COMMIT = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9012";

const BASE_PART = {
	ref: "R1",
	value: "10k",
	symbol: "Device:R",
	footprint: "Resistor_SMD:R_0603_1608Metric",
};

function makePart(overrides = {}) {
	return { id: newId("part"), props: {}, ...BASE_PART, ...overrides };
}

function makeCleanIR(partOverrides = {}) {
	const parts = ["R1", "R2"].map((ref) =>
		makePart(ref === "R1" ? { ref, ...partOverrides } : { ref }),
	);
	const connect = (name, pin) => ({
		id: newId("net"),
		name,
		pins: parts.map((p) => ({ partId: p.id, pin })),
	});
	return {
		schemaVersion: 1,
		name: "TestDesign",
		parts,
		nets: [connect("VCC", "1"), connect("GND", "2")],
		constraints: [
			{ id: "c1", kind: "rail", target: "VCC", value: 3.3, unit: "V" },
		],
	};
}

const BASE_ENV = {
	name: "LabEnv",
	ambientC: { min: 20, max: 25 },
	humidityPct: { min: 40, max: 60 },
	altitudeM: 100,
};

function makeEnv(overrides = {}) {
	return { id: newId("env"), ...BASE_ENV, ...overrides };
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

function assertSuccess(res) {
	assert.equal(res.ok, true);
	return res.output;
}

function assertFailure(res, expectedError) {
	assert.equal(res.ok, false);
	if (typeof expectedError === "string") {
		assert.equal(res.error, expectedError);
	} else if (expectedError instanceof RegExp) {
		assert.match(res.error, expectedError);
	} else {
		assert.ok(typeof res.error === "string");
	}
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
	const out = assertSuccess(res);
	assert.equal(out.valid, true);
	assert.deepEqual(out.errors, []);
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
	const out = assertSuccess(res);
	assert.deepEqual(out.issues, []);
}

function assertDetectedIssues(res) {
	const out = assertSuccess(res);
	assertNonEmptyArray(out.issues);
}

function assertMockIssueResult(res, expectedId) {
	const out = assertSuccess(res);
	assert.equal(out.issues.length, 1);
	assert.equal(out.issues[0]?.id, expectedId);
}

function assertAutoPlaceSuccess(res) {
	const out = assertSuccess(res);
	assert.ok(Array.isArray(out.placed));
	assert.equal(out.placed.length, 2);
	assert.ok(out.ir.parts[0]?.placement && out.ir.parts[1]?.placement);
}

function assertMockPlacedResult(res, expectedPlaced) {
	const out = assertSuccess(res);
	assert.deepEqual(out.placed, expectedPlaced);
}

function assertValidSexprDoc(res, rootSym) {
	const out = assertSuccess(res);
	assert.equal(typeof out.text, "string");
	assert.ok(Array.isArray(out.warnings));
	const parsed = parse(out.text);
	assert.ok(parsed);
	assert.equal(parsed[0]?.sym, rootSym);
}

function assertInvalidIr(res) {
	assertFailure(res, /Invalid circuit IR/i);
}

function assertThermalRunSuccess(res) {
	const out = assertSuccess(res);
	assert.deepEqual(
		{ status: out.run.status, kind: out.run.kind },
		{ status: "done", kind: "thermal" },
	);
	assert.ok(Array.isArray(out.issues));
}

function assertSimulationFailedOutput(res) {
	const out = assertSuccess(res);
	assert.equal(out.run.status, "failed");
	assert.match(out.error, /.+/);
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
		const res = await invokeTool("ir.to_kicad_sch", {
			ir: { schemaVersion: 999 },
		});
		assertInvalidIr(res);
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
		const res = await invokeTool("ir.to_kicad_pcb", {
			ir: { schemaVersion: 999 },
			boardW: 50,
			boardH: 50,
		});
		assertInvalidIr(res);
	});
});

describe("sim.run tool", () => {
	test("runs thermal simulation end-to-end", async () => {
		const part = {
			id: newId("part"),
			ref: "U1",
			value: "LDO",
			symbol: "Reg:LDO",
			footprint: "Pkg:SOT-223",
			props: { powerW: 2.0, thetaJA: 50, tjMaxC: 125 },
		};
		const inputs = { ir: { parts: [part] } };
		const res = await invokeTool("sim.run", {
			kind: "thermal",
			env: makeEnv(),
			commit: TEST_COMMIT,
			inputs,
		});
		assertThermalRunSuccess(res);
	});

	test("captures simulation error in output when env is invalid", async () => {
		const invalidEnv = makeEnv({ ambientC: { min: 40, max: 10 } });
		const res = await invokeTool("sim.run", {
			kind: "thermal",
			env: invalidEnv,
			commit: TEST_COMMIT,
			inputs: {},
		});
		assertSimulationFailedOutput(res);
	});

	test("returns ok:false when handler throws or rejects", async () => {
		const res = await invokeTool(
			"sim.run",
			{
				kind: "thermal",
				env: makeEnv(),
				commit: TEST_COMMIT,
				inputs: {},
			},
			{
				runSimulation: async () => {
					throw new Error("Simulation crash");
				},
			},
		);
		assertFailure(res, "Simulation crash");
	});
});

describe("input validation errors", () => {
	const BAD_INPUT_CASES = [
		{ tool: "ir.validate", input: {}, label: "missing ir" },
		{ tool: "erc.run", input: { ir: {} }, label: "missing commit" },
		{ tool: "erc.run", input: { commit: "abc" }, label: "missing ir" },
		{
			tool: "ir.auto_place",
			input: { ir: {} },
			label: "missing boardW, boardH",
		},
		{
			tool: "ir.auto_place",
			input: { ir: {}, boardW: 50 },
			label: "missing boardH",
		},
		{ tool: "ir.to_kicad_sch", input: {}, label: "missing ir" },
		{
			tool: "ir.to_kicad_pcb",
			input: { ir: {} },
			label: "missing boardW, boardH",
		},
		{ tool: "sim.run", input: {}, label: "missing required sim fields" },
		{
			tool: "sim.run",
			input: { kind: "invalid-kind", env: {}, commit: "abc", inputs: {} },
			label: "invalid kind enum",
		},
		{
			tool: "ir.validate",
			input: { ir: {}, extraField: true },
			label: "extra property on additionalProperties: false",
		},
	];

	for (const { tool, input, label } of BAD_INPUT_CASES) {
		test(`${tool} rejects input: ${label}`, async () => {
			const res = await invokeTool(tool, input);
			assertFailure(res);
		});
	}
});
