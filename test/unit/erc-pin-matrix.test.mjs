import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	checkNet,
	PIN_TYPES,
	pinPairSeverity,
} from "../../backend/src/engine/erc-pin-matrix.js";

// --- helpers ---

function pin(ref, type, name) {
	return name === undefined
		? { ref, pin: "1", type }
		: { ref, pin: "1", type, name };
}

// One pin per type, on parts U1..Un.
const netOf = (types) => types.map((t, n) => pin(`U${n + 1}`, t));

// [ref, type, name] tuples -> pins
const pinsOf = (specs) => specs.map((s) => pin(...s));

const conflictsOf = (issues) =>
	issues.filter((i) => i.message.includes("conflict"));

// --- PIN_TYPES ---

describe("PIN_TYPES", () => {
	test("exports 12 canonical types", () => {
		assert.equal(PIN_TYPES.length, 12);
	});

	test("includes no_connect", () => {
		assert.ok(PIN_TYPES.includes("no_connect"));
	});
});

// --- symmetry ---

describe("pinPairSeverity symmetry", () => {
	test("all 144 pairs are symmetric", () => {
		for (const a of PIN_TYPES) {
			for (const b of PIN_TYPES) {
				assert.equal(
					pinPairSeverity(a, b),
					pinPairSeverity(b, a),
					`asymmetric: ${a} vs ${b}`,
				);
			}
		}
	});
});

// --- pair rules: expected severity -> [type A, type B] pairs ---

const PAIR_CASES = {
	error: [
		["output", "output"],
		["output", "power_out"],
		["power_out", "power_out"],
		["output", "open_collector"],
		["output", "open_emitter"],
		["no_connect", "input"],
		["no_connect", "output"],
	],
	warning: [
		["tri_state", "output"],
		["unspecified", "input"],
		["unspecified", "output"],
	],
	ok: [
		["no_connect", "no_connect"],
		["input", "output"],
		["passive", "passive"],
		["free", "bidirectional"],
	],
};

describe("pinPairSeverity", () => {
	for (const [expected, pairs] of Object.entries(PAIR_CASES)) {
		for (const [a, b] of pairs) {
			test(`${a} + ${b} -> ${expected}`, () => {
				assert.equal(pinPairSeverity(a, b), expected);
			});
		}
	}
});

// --- checkNet conflict counts ---

// kicad-cli reports n-1 pin_to_pin violations per cluster of mutually
// conflicting pins, not every pair: vme-wren power-supply-3 has 6 VOUT
// power outputs plus a PWR_FLAG on P3V3 and kicad-cli lists 6 violations.
// [case, pin types, expected conflict count]
const CONFLICT_COUNT_CASES = [
	["output+output+input", ["output", "output", "input"], 1],
	[
		"3 outputs + input: n-1, not 3 pairs",
		["output", "output", "output", "input"],
		2,
	],
	["6 power outputs", Array(6).fill("power_out"), 5],
	[
		"output vs two open drains (a star)",
		["output", "open_collector", "open_emitter"],
		2,
	],
];

describe("checkNet conflict counts", () => {
	for (const [name, types, count] of CONFLICT_COUNT_CASES) {
		test(`${name} -> ${count}`, () => {
			assert.equal(conflictsOf(checkNet(netOf(types))).length, count);
		});
	}

	test("driven net still reports pin-pair conflicts", () => {
		const pins = netOf(["output", "output"]);
		assert.equal(checkNet(pins, { driven: true }).length, 1);
	});

	test("parallel pads join the cluster as one pin", () => {
		const pins = pinsOf([
			["U1", "output", "SW"],
			["U1", "output", "SW"],
			["U2", "output"],
		]);
		assert.equal(conflictsOf(checkNet(pins)).length, 1);
	});

	test("error pairs are kept before warnings in a cluster", () => {
		const pins = netOf(["tri_state", "output", "output"]);
		const severities = conflictsOf(checkNet(pins)).map((i) => i.severity);
		assert.deepEqual(severities.sort(), ["error", "warning"]);
	});
});

// --- checkNet drive checks: error message -> [pin types, expected present] ---

const DRIVE_CASES = {
	"net has only inputs (not driven)": [
		[["input", "input"], true],
		[["input"], true],
		[["input", "output"], false],
	],
	"power_in not driven": [
		[["power_in"], true],
		[["power_in", "passive"], true],
		[["power_in", "power_out"], false],
		// KiCad: only power_out drives power_in (multichannel IC1 V+ via J5 bidi).
		[["power_in", "output"], true],
		[["power_in", "bidirectional"], true],
	],
};

describe("checkNet drive checks", () => {
	for (const [message, cases] of Object.entries(DRIVE_CASES)) {
		for (const [types, present] of cases) {
			test(`${types.join(" + ")} -> ${present ? "" : "no "}"${message}"`, () => {
				const found = checkNet(netOf(types)).find((i) => i.message === message);
				assert.equal(found?.severity, present ? "error" : undefined);
			});
		}
	}

	test("driven net skips undriven input and power_in checks", () => {
		assert.deepEqual(
			checkNet(netOf(["input", "power_in"]), { driven: true }),
			[],
		);
	});
});

describe("checkNet empty / no conflict", () => {
	test("empty pins -> no issues", () => {
		assert.deepEqual(checkNet([]), []);
	});

	test("passive + passive -> no issues", () => {
		assert.deepEqual(checkNet(netOf(["passive", "passive"])), []);
	});
});

describe("checkNet unspecified pins", () => {
	// kicad-cli (KiCad 10 demos) warns once per unspecified pin, against a
	// typed partner; was one summary warning per net.
	test("2 unspecified + input + output -> one warning each", () => {
		const pins = netOf(["unspecified", "unspecified", "input", "output"]);
		const found = conflictsOf(checkNet(pins));
		assert.deepEqual(
			found.map((i) => [i.severity, i.pins.map((p) => p.ref)]),
			[
				["warning", ["U1", "U3"]],
				["warning", ["U2", "U3"]],
			],
		);
	});

	// Typed pins that do not conflict with each other add no warning.
	test("unspecified + input + input -> 1 warning", () => {
		const found = checkNet(netOf(["unspecified", "input", "input"]));
		assert.deepEqual(
			found.map((i) => [i.severity, i.pins.map((p) => p.ref)]),
			[["warning", ["U1", "U2"]]],
		);
	});

	test("3 unspecified pins only -> k-1 = 2 warnings", () => {
		const found = checkNet(
			netOf(["unspecified", "unspecified", "unspecified"]),
		);
		assert.equal(conflictsOf(found).length, 2);
	});

	test("unspecified + power_in port -> 1 warning", () => {
		const port = { ref: "#PWR01", pin: "1", type: "power_in" };
		const pins = [pin("U1", "unspecified"), port];
		const found = conflictsOf(checkNet(pins, { driven: true }));
		assert.equal(found.length, 1);
		assert.equal(found[0].severity, "warning");
	});

	test("error edges are taken before warnings in one cluster", () => {
		const found = checkNet(netOf(["unspecified", "output", "output"]));
		assert.deepEqual(
			found.map((i) => i.severity),
			["error", "warning"],
		);
	});

	test("lone unspecified pin -> no warning", () => {
		assert.deepEqual(checkNet(netOf(["unspecified"])), []);
	});
});

// kicad-cli ERC treats same-named output pins of one symbol (a regulator's
// parallel SW pads) as one pin, but still flags differently named outputs
// and same-named power outputs (vme-wren power-supply demos).
// Pin A is U1 "SW" of the given type; [type, ref B, name B, expected issues]
const PARALLEL_OUTPUT_CASES = [
	["output", "U1", "SW", 0], // same part, same name outputs
	["output", "U1", "B", 1], // same part, different names
	["output", "U2", "SW", 1], // same name on different parts
	["power_out", "U1", "SW", 1], // same part, same name power outputs
];

describe("checkNet parallel output pins of one part", () => {
	for (const [type, ref, name, count] of PARALLEL_OUTPUT_CASES) {
		test(`U1 SW + ${ref} ${name} (${type}) -> ${count} issue(s)`, () => {
			const pins = pinsOf([
				["U1", type, "SW"],
				[ref, type, name],
			]);
			assert.equal(checkNet(pins).length, count);
		});
	}
});
