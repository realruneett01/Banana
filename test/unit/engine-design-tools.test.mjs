import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { parse } from "../../backend/src/engine/sexpr.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerDesignTools } from "../../backend/src/engine/tools/design-tools.js";

const TEST_COMMIT = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9012";

function makePart(overrides = {}) {
	return {
		id: newId("part"),
		ref: "R1",
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		...overrides,
	};
}

function makeCleanIR(partOverrides = {}) {
	const part1 = makePart({ ref: "R1", ...partOverrides });
	const part2 = makePart({ ref: "R2" });
	const net1 = {
		id: newId("net"),
		name: "VCC",
		pins: [
			{ partId: part1.id, pin: "1" },
			{ partId: part2.id, pin: "1" },
		],
	};
	const net2 = {
		id: newId("net"),
		name: "GND",
		pins: [
			{ partId: part1.id, pin: "2" },
			{ partId: part2.id, pin: "2" },
		],
	};
	return {
		schemaVersion: 1,
		name: "TestDesign",
		parts: [part1, part2],
		nets: [net1, net2],
		constraints: [
			{ id: "c1", kind: "rail", target: "VCC", value: 3.3, unit: "V" },
		],
	};
}

function makeEnv(overrides = {}) {
	return {
		id: newId("env"),
		name: "LabEnv",
		ambientC: { min: 20, max: 25 },
		humidityPct: { min: 40, max: 60 },
		altitudeM: 100,
		...overrides,
	};
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
		const names = tools.map((t) => t.name).sort();
		assert.deepEqual(names, [
			"erc.run",
			"ir.auto_place",
			"ir.to_kicad_pcb",
			"ir.to_kicad_sch",
			"ir.validate",
			"sim.run",
		]);
		for (const tool of tools) {
			assert.equal(tool.permission, "read");
			assert.equal(typeof tool.description, "string");
			assert.ok(tool.description.length > 0);
		}
	});
});

describe("ir.validate tool", () => {
	test("returns valid:true and empty errors on valid IR", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const ir = makeCleanIR();
		const res = await registry.call("ir.validate", { ir });
		assert.equal(res.ok, true);
		assert.equal(res.output.valid, true);
		assert.deepEqual(res.output.errors, []);
	});

	test("returns valid:false and errors array on invalid IR", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const invalidIr = { schemaVersion: 999, name: "Broken" };
		const res = await registry.call("ir.validate", { ir: invalidIr });
		assert.equal(res.ok, true);
		assert.equal(res.output.valid, false);
		assert.ok(Array.isArray(res.output.errors));
		assert.ok(res.output.errors.length > 0);
	});

	test("supports injected deps.validateCircuitIR", async () => {
		let injectedCalled = false;
		const registry = createRegistry();
		registerDesignTools(registry, {
			validateCircuitIR: () => {
				injectedCalled = true;
				return { ok: true, errors: [] };
			},
		});
		const res = await registry.call("ir.validate", { ir: {} });
		assert.equal(res.ok, true);
		assert.equal(injectedCalled, true);
	});
});

describe("erc.run tool", () => {
	test("returns zero issues for clean IR", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const ir = makeCleanIR();
		const res = await registry.call("erc.run", { ir, commit: TEST_COMMIT });
		assert.equal(res.ok, true);
		assert.deepEqual(res.output.issues, []);
	});

	test("returns detected issues for faulty IR", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const part = makePart({ ref: "U1", footprint: "" });
		const ir = {
			schemaVersion: 1,
			name: "FaultyBoard",
			parts: [part],
			nets: [],
			constraints: [],
		};
		const res = await registry.call("erc.run", { ir, commit: TEST_COMMIT });
		assert.equal(res.ok, true);
		assert.ok(Array.isArray(res.output.issues));
		assert.ok(res.output.issues.length > 0);
	});

	test("supports injected deps.runErc", async () => {
		const registry = createRegistry();
		registerDesignTools(registry, {
			runErc: () => [{ id: "mock_issue", severity: "warning" }],
		});
		const res = await registry.call("erc.run", { ir: {}, commit: "test" });
		assert.equal(res.ok, true);
		assert.equal(res.output.issues.length, 1);
		assert.equal(res.output.issues[0].id, "mock_issue");
	});
});

describe("ir.auto_place tool", () => {
	test("returns placed component IDs and updated IR", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const ir = makeCleanIR();
		const res = await registry.call("ir.auto_place", {
			ir,
			boardW: 100,
			boardH: 80,
			gridMm: 2.54,
			marginMm: 5,
		});
		assert.equal(res.ok, true);
		assert.ok(Array.isArray(res.output.placed));
		assert.equal(res.output.placed.length, 2);
		assert.ok(res.output.ir.parts[0].placement);
		assert.ok(res.output.ir.parts[1].placement);
	});

	test("reports error when board is too small", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const ir = makeCleanIR();
		const res = await registry.call("ir.auto_place", {
			ir,
			boardW: 1,
			boardH: 1,
		});
		assert.equal(res.ok, false);
		assert.match(res.error, /board too small/i);
	});

	test("supports injected deps.autoPlace", async () => {
		const registry = createRegistry();
		registerDesignTools(registry, {
			autoPlace: () => ({ ir: { mock: true }, placed: ["p1"] }),
		});
		const res = await registry.call("ir.auto_place", {
			ir: {},
			boardW: 50,
			boardH: 50,
		});
		assert.equal(res.ok, true);
		assert.deepEqual(res.output.placed, ["p1"]);
	});
});

describe("ir.to_kicad_sch tool", () => {
	test("returns schematic text accepted by sexpr parse", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const ir = makeCleanIR();
		const res = await registry.call("ir.to_kicad_sch", {
			ir,
			title: "Custom Schematic",
		});
		assert.equal(res.ok, true);
		assert.equal(typeof res.output.text, "string");
		assert.ok(Array.isArray(res.output.warnings));
		const parsed = parse(res.output.text);
		assert.ok(parsed);
		assert.equal(parsed[0].sym, "kicad_sch");
	});

	test("reports engine error on invalid IR", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const res = await registry.call("ir.to_kicad_sch", {
			ir: { schemaVersion: 999 },
		});
		assert.equal(res.ok, false);
		assert.match(res.error, /Invalid circuit IR/i);
	});
});

describe("ir.to_kicad_pcb tool", () => {
	test("returns pcb text accepted by sexpr parse", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const ir = makeCleanIR({
			placement: { x: 20, y: 20, rot: 0, side: "F" },
		});
		const res = await registry.call("ir.to_kicad_pcb", {
			ir,
			boardW: 80,
			boardH: 60,
		});
		assert.equal(res.ok, true);
		assert.equal(typeof res.output.text, "string");
		assert.ok(Array.isArray(res.output.warnings));
		const parsed = parse(res.output.text);
		assert.ok(parsed);
		assert.equal(parsed[0].sym, "kicad_pcb");
	});

	test("reports engine error on invalid IR", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const res = await registry.call("ir.to_kicad_pcb", {
			ir: { schemaVersion: 999 },
			boardW: 50,
			boardH: 50,
		});
		assert.equal(res.ok, false);
		assert.match(res.error, /Invalid circuit IR/i);
	});
});

describe("sim.run tool", () => {
	test("runs thermal simulation end-to-end", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const env = makeEnv();
		const part = {
			id: newId("part"),
			ref: "U1",
			value: "LDO",
			symbol: "Reg:LDO",
			footprint: "Pkg:SOT-223",
			props: { powerW: 2.0, thetaJA: 50, tjMaxC: 125 },
		};
		const inputs = { ir: { parts: [part] } };
		const res = await registry.call("sim.run", {
			kind: "thermal",
			env,
			commit: TEST_COMMIT,
			inputs,
		});
		assert.equal(res.ok, true);
		assert.equal(res.output.run.status, "done");
		assert.equal(res.output.run.kind, "thermal");
		assert.ok(Array.isArray(res.output.issues));
	});

	test("captures simulation error in output when env is invalid", async () => {
		const registry = createRegistry();
		registerDesignTools(registry);
		const invalidEnv = makeEnv({ ambientC: { min: 40, max: 10 } });
		const res = await registry.call("sim.run", {
			kind: "thermal",
			env: invalidEnv,
			commit: TEST_COMMIT,
			inputs: {},
		});
		assert.equal(res.ok, true);
		assert.equal(res.output.run.status, "failed");
		assert.ok(typeof res.output.error === "string");
	});

	test("returns ok:false when handler throws or rejects", async () => {
		const registry = createRegistry();
		registerDesignTools(registry, {
			runSimulation: async () => {
				throw new Error("Simulation crash");
			},
		});
		const res = await registry.call("sim.run", {
			kind: "thermal",
			env: makeEnv(),
			commit: TEST_COMMIT,
			inputs: {},
		});
		assert.equal(res.ok, false);
		assert.equal(res.error, "Simulation crash");
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
			const registry = createRegistry();
			registerDesignTools(registry);
			const res = await registry.call(tool, input);
			assert.equal(res.ok, false);
			assert.ok(typeof res.error === "string");
		});
	}
});
