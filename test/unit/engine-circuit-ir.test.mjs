import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	CIRCUIT_IR_SCHEMA,
	validateCircuitIR,
} from "../../backend/src/engine/circuit-ir.js";
import { newId } from "../../backend/src/engine/ids.js";

function makeValidPart(overrides = {}) {
	return {
		id: newId("part"),
		ref: "R1",
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: { Tolerance: "1%" },
		...overrides,
	};
}

function makeValidNet(partId, overrides = {}) {
	return {
		id: newId("net"),
		name: "VCC",
		pins: [{ partId, pin: "1" }],
		...overrides,
	};
}

function makeValidConstraint(overrides = {}) {
	return {
		id: "c_rail_vcc",
		kind: "rail",
		target: "VCC",
		value: 3.3,
		unit: "V",
		...overrides,
	};
}

function makeValidCircuitIR() {
	const part = makeValidPart();
	const net = makeValidNet(part.id);
	const constraint = makeValidConstraint();
	return {
		schemaVersion: 1,
		name: "PowerSupply",
		parts: [part],
		nets: [net],
		constraints: [constraint],
	};
}

const WEIRD_INPUTS = [
	null,
	undefined,
	123,
	"string",
	true,
	false,
	Number.NaN,
	{},
	[],
	() => {},
	Symbol("sym"),
];

function runValidCase(createIR, name) {
	const res = validateCircuitIR(createIR());
	assert.strictEqual(res.ok, true, `${name} should have ok === true`);
	assert.deepStrictEqual(res.errors, [], `${name} should have no errors`);
}

function runRejectionCase(mutate, predicate, failMessage) {
	const ir = makeValidCircuitIR();
	mutate(ir);
	const res = validateCircuitIR(ir);
	assert.strictEqual(res.ok, false, "validation should fail");
	assert.ok(res.errors.length >= 1, "expected at least one error");
	assert.ok(
		res.errors.some(predicate),
		`${failMessage}, got: ${JSON.stringify(res.errors)}`,
	);
}

function runGarbageInputCase(input) {
	assert.doesNotThrow(() => {
		const res = validateCircuitIR(input);
		assert.strictEqual(
			res.ok,
			false,
			`garbage input ${String(input)} must fail validation`,
		);
		assert.ok(
			Array.isArray(res.errors),
			`garbage input ${String(input)} must have errors array`,
		);
	});
}

describe("circuit-ir module contract", () => {
	test("exports match the contract exactly", async () => {
		const mod = await import("../../backend/src/engine/circuit-ir.js");
		const exportedKeys = Object.keys(mod).sort();
		assert.deepEqual(exportedKeys, ["CIRCUIT_IR_SCHEMA", "validateCircuitIR"]);
	});

	test("exported schema defines expected root type and additionalProperties", () => {
		assert.equal(CIRCUIT_IR_SCHEMA.type, "object");
		assert.equal(CIRCUIT_IR_SCHEMA.additionalProperties, false);
		assert.equal(typeof validateCircuitIR, "function");
	});
});

describe("validateCircuitIR: valid cases", () => {
	const VALID_CASES = [
		{
			name: "accepts minimal valid circuit IR",
			createIR: () => ({
				schemaVersion: 1,
				name: "MinimalBoard",
				parts: [],
				nets: [],
				constraints: [],
			}),
		},
		{
			name: "accepts complete valid circuit IR with placement",
			createIR: () => {
				const part = {
					...makeValidPart({ ref: "U1", value: "STM32F401" }),
					placement: { x: 50.0, y: 30.5, rot: 90, side: "F" },
				};
				const net = makeValidNet(part.id);
				const constraint = makeValidConstraint();
				return {
					schemaVersion: 1,
					name: "MainBoard",
					parts: [part],
					nets: [net],
					constraints: [constraint],
				};
			},
		},
		{
			name: "accepts all constraint kinds",
			createIR: () => {
				const kinds = [
					"rail",
					"current",
					"impedance",
					"keepout",
					"size",
					"layers",
				];
				const part = makeValidPart();
				const net = makeValidNet(part.id);
				const constraints = kinds.map((kind, index) => ({
					id: `c_${kind}_${index}`,
					kind,
					target: "NET1",
					value: 50,
					unit: "ohm",
				}));
				return {
					schemaVersion: 1,
					name: "ConstraintTest",
					parts: [part],
					nets: [net],
					constraints,
				};
			},
		},
	];

	for (const { name, createIR } of VALID_CASES) {
		test(name, () => {
			runValidCase(createIR, name);
		});
	}
});

describe("validateCircuitIR: schema rule violations", () => {
	const SCHEMA_FAILURES = [
		{
			label: "missing schemaVersion",
			mutate: (ir) => delete ir.schemaVersion,
			expectedPath: "$.schemaVersion",
		},
		{
			label: "invalid schemaVersion (not 1)",
			mutate: (ir) => {
				ir.schemaVersion = 2;
			},
			expectedPath: "$.schemaVersion",
		},
		{
			label: "missing name",
			mutate: (ir) => delete ir.name,
			expectedPath: "$.name",
		},
		{
			label: "wrong name type",
			mutate: (ir) => {
				ir.name = 123;
			},
			expectedPath: "$.name",
		},
		{
			label: "missing parts",
			mutate: (ir) => delete ir.parts,
			expectedPath: "$.parts",
		},
		{
			label: "parts not an array",
			mutate: (ir) => {
				ir.parts = "not-array";
			},
			expectedPath: "$.parts",
		},
		{
			label: "missing nets",
			mutate: (ir) => delete ir.nets,
			expectedPath: "$.nets",
		},
		{
			label: "nets not an array",
			mutate: (ir) => {
				ir.nets = "not-array";
			},
			expectedPath: "$.nets",
		},
		{
			label: "missing constraints",
			mutate: (ir) => delete ir.constraints,
			expectedPath: "$.constraints",
		},
		{
			label: "constraints not an array",
			mutate: (ir) => {
				ir.constraints = "not-array";
			},
			expectedPath: "$.constraints",
		},
		{
			label: "unexpected root property",
			mutate: (ir) => {
				ir.unknownProp = true;
			},
			expectedPath: "$.unknownProp",
		},
		{
			label: "part missing id",
			mutate: (ir) => delete ir.parts[0].id,
			expectedPath: "$.parts[0].id",
		},
		{
			label: "part missing ref",
			mutate: (ir) => delete ir.parts[0].ref,
			expectedPath: "$.parts[0].ref",
		},
		{
			label: "part missing value",
			mutate: (ir) => delete ir.parts[0].value,
			expectedPath: "$.parts[0].value",
		},
		{
			label: "part missing symbol",
			mutate: (ir) => delete ir.parts[0].symbol,
			expectedPath: "$.parts[0].symbol",
		},
		{
			label: "part missing footprint",
			mutate: (ir) => delete ir.parts[0].footprint,
			expectedPath: "$.parts[0].footprint",
		},
		{
			label: "part missing props",
			mutate: (ir) => delete ir.parts[0].props,
			expectedPath: "$.parts[0].props",
		},
		{
			label: "part invalid props type",
			mutate: (ir) => {
				ir.parts[0].props = "not-object";
			},
			expectedPath: "$.parts[0].props",
		},
		{
			label: "part unexpected property",
			mutate: (ir) => {
				ir.parts[0].extra = "bad";
			},
			expectedPath: "$.parts[0].extra",
		},
		{
			label: "placement missing side",
			mutate: (ir) => {
				ir.parts[0].placement = { x: 0, y: 0, rot: 0 };
			},
			expectedPath: "$.parts[0].placement.side",
		},
		{
			label: "placement invalid side",
			mutate: (ir) => {
				ir.parts[0].placement = { x: 0, y: 0, rot: 0, side: "TOP" };
			},
			expectedPath: "$.parts[0].placement.side",
		},
		{
			label: "net missing id",
			mutate: (ir) => delete ir.nets[0].id,
			expectedPath: "$.nets[0].id",
		},
		{
			label: "net missing name",
			mutate: (ir) => delete ir.nets[0].name,
			expectedPath: "$.nets[0].name",
		},
		{
			label: "net missing pins",
			mutate: (ir) => delete ir.nets[0].pins,
			expectedPath: "$.nets[0].pins",
		},
		{
			label: "pin missing partId",
			mutate: (ir) => delete ir.nets[0].pins[0].partId,
			expectedPath: "$.nets[0].pins[0].partId",
		},
		{
			label: "pin missing pin",
			mutate: (ir) => delete ir.nets[0].pins[0].pin,
			expectedPath: "$.nets[0].pins[0].pin",
		},
		{
			label: "constraint missing id",
			mutate: (ir) => delete ir.constraints[0].id,
			expectedPath: "$.constraints[0].id",
		},
		{
			label: "constraint missing kind",
			mutate: (ir) => delete ir.constraints[0].kind,
			expectedPath: "$.constraints[0].kind",
		},
		{
			label: "constraint invalid kind enum",
			mutate: (ir) => {
				ir.constraints[0].kind = "not_a_kind";
			},
			expectedPath: "$.constraints[0].kind",
		},
		{
			label: "constraint missing target",
			mutate: (ir) => delete ir.constraints[0].target,
			expectedPath: "$.constraints[0].target",
		},
		{
			label: "constraint missing value",
			mutate: (ir) => delete ir.constraints[0].value,
			expectedPath: "$.constraints[0].value",
		},
		{
			label: "constraint missing unit",
			mutate: (ir) => delete ir.constraints[0].unit,
			expectedPath: "$.constraints[0].unit",
		},
	];

	for (const { label, mutate, expectedPath } of SCHEMA_FAILURES) {
		test(`rejects ${label}`, () => {
			runRejectionCase(
				mutate,
				(err) => err.startsWith(expectedPath),
				`Expected error starting with "${expectedPath}"`,
			);
		});
	}
});

describe("validateCircuitIR: semantic rule violations", () => {
	const SEMANTIC_FAILURES = [
		{
			label: "invalid part id kind",
			mutate: (ir) => {
				ir.parts[0].id = newId("net");
				ir.nets[0].pins[0].partId = ir.parts[0].id;
			},
			expectedError: "$.parts[0].id: must be a part id",
		},
		{
			label: "invalid net id kind",
			mutate: (ir) => {
				ir.nets[0].id = newId("part");
			},
			expectedError: "$.nets[0].id: must be a net id",
		},
		{
			label: "duplicate ref values in parts",
			mutate: (ir) => {
				ir.parts.push(makeValidPart({ ref: "R1" }));
			},
			expectedError: "$.parts[1].ref: duplicate ref",
		},
		{
			label: "net pin pointing at nonexistent partId",
			mutate: (ir) => {
				ir.nets[0].pins.push({ partId: newId("part"), pin: "2" });
			},
			expectedError: "$.nets[0].pins[1].partId: partId",
		},
		{
			label: "duplicate part IDs",
			mutate: (ir) => {
				ir.parts.push(makeValidPart({ id: ir.parts[0].id, ref: "R2" }));
			},
			expectedError: "$.parts[1].id: duplicate id",
		},
		{
			label: "duplicate net IDs",
			mutate: (ir) => {
				ir.nets.push(
					makeValidNet(ir.parts[0].id, {
						id: ir.nets[0].id,
						name: "GND",
					}),
				);
			},
			expectedError: "$.nets[1].id: duplicate id",
		},
		{
			label: "duplicate constraint IDs",
			mutate: (ir) => {
				ir.constraints.push(makeValidConstraint({ id: ir.constraints[0].id }));
			},
			expectedError: "$.constraints[1].id: duplicate id",
		},
		{
			label: "duplicate ID across part and net",
			mutate: (ir) => {
				const sharedId = newId("part");
				ir.parts[0].id = sharedId;
				ir.nets[0].id = sharedId;
				ir.nets[0].pins[0].partId = sharedId;
			},
			expectedError: "$.nets[0].id: duplicate id",
		},
		{
			label: "duplicate ID across part and constraint",
			mutate: (ir) => {
				ir.constraints[0].id = ir.parts[0].id;
			},
			expectedError: "$.constraints[0].id: duplicate id",
		},
	];

	for (const { label, mutate, expectedError } of SEMANTIC_FAILURES) {
		test(`rejects ${label}`, () => {
			runRejectionCase(
				mutate,
				(err) => err.includes(expectedError),
				`Expected error containing "${expectedError}"`,
			);
		});
	}
});

describe("validateCircuitIR: garbage input resilience", () => {
	for (const input of WEIRD_INPUTS) {
		test(`never throws on: ${String(input)}`, () => {
			runGarbageInputCase(input);
		});
	}
});
