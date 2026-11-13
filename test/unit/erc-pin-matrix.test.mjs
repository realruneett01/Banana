import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	checkNet,
	PIN_TYPES,
	pinPairSeverity,
} from "../../backend/src/engine/erc-pin-matrix.js";

// --- helpers ---

function pin(ref, type) {
	return { ref, pin: "1", type };
}

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

// --- pair rules ---

const ERROR_PAIRS = [
	["output", "output"],
	["output", "power_out"],
	["power_out", "power_out"],
	["output", "open_collector"],
	["output", "open_emitter"],
];

describe("pinPairSeverity error pairs", () => {
	for (const [a, b] of ERROR_PAIRS) {
		test(`${a} + ${b} -> error`, () => {
			assert.equal(pinPairSeverity(a, b), "error");
		});
	}
});

describe("pinPairSeverity warning pairs", () => {
	test("tri_state + output -> warning", () => {
		assert.equal(pinPairSeverity("tri_state", "output"), "warning");
	});

	test("unspecified + input -> warning", () => {
		assert.equal(pinPairSeverity("unspecified", "input"), "warning");
	});

	test("unspecified + output -> warning", () => {
		assert.equal(pinPairSeverity("unspecified", "output"), "warning");
	});
});

describe("pinPairSeverity no_connect rules", () => {
	test("no_connect + no_connect -> ok", () => {
		assert.equal(pinPairSeverity("no_connect", "no_connect"), "ok");
	});

	test("no_connect + input -> error", () => {
		assert.equal(pinPairSeverity("no_connect", "input"), "error");
	});

	test("no_connect + output -> error", () => {
		assert.equal(pinPairSeverity("no_connect", "output"), "error");
	});
});

describe("pinPairSeverity ok pairs", () => {
	test("input + output -> ok", () => {
		assert.equal(pinPairSeverity("input", "output"), "ok");
	});

	test("passive + passive -> ok", () => {
		assert.equal(pinPairSeverity("passive", "passive"), "ok");
	});

	test("free + anything -> ok (bidirectional)", () => {
		assert.equal(pinPairSeverity("free", "bidirectional"), "ok");
	});
});

// --- checkNet ---

describe("checkNet dedup", () => {
	test("3-pin net with output+output produces one issue, not two", () => {
		const pins = [pin("U1", "output"), pin("U2", "output"), pin("U3", "input")];
		const issues = checkNet(pins);
		const conflicts = issues.filter((i) => i.message.includes("conflict"));
		assert.equal(conflicts.length, 1);
	});

	test("each pair counted once across 4 pins", () => {
		const pins = [
			pin("U1", "output"),
			pin("U2", "output"),
			pin("U3", "output"),
			pin("U4", "input"),
		];
		const issues = checkNet(pins);
		const conflicts = issues.filter((i) => i.message.includes("conflict"));
		// 3 output+output pairs
		assert.equal(conflicts.length, 3);
	});
});

describe("checkNet undriven input net", () => {
	test("all-input net -> error", () => {
		const pins = [pin("U1", "input"), pin("U2", "input")];
		const issues = checkNet(pins);
		const driven = issues.find((i) => i.message.includes("not driven"));
		assert.ok(driven, "expected 'not driven' issue");
		assert.equal(driven.severity, "error");
	});

	test("single input pin -> error", () => {
		const pins = [pin("U1", "input")];
		const issues = checkNet(pins);
		assert.ok(issues.some((i) => i.message.includes("not driven")));
	});

	test("input + output -> no undriven error", () => {
		const pins = [pin("U1", "input"), pin("U2", "output")];
		const issues = checkNet(pins);
		assert.ok(!issues.some((i) => i.message.includes("not driven")));
	});
});

describe("checkNet undriven power_in", () => {
	test("power_in alone -> error", () => {
		const pins = [pin("U1", "power_in")];
		const issues = checkNet(pins);
		assert.ok(issues.some((i) => i.message === "power_in not driven"));
	});

	test("power_in + passive -> error (passive does not drive)", () => {
		const pins = [pin("U1", "power_in"), pin("U2", "passive")];
		const issues = checkNet(pins);
		assert.ok(issues.some((i) => i.message === "power_in not driven"));
	});

	test("power_in + power_out -> no power_in error", () => {
		const pins = [pin("U1", "power_in"), pin("U2", "power_out")];
		const issues = checkNet(pins);
		assert.ok(!issues.some((i) => i.message === "power_in not driven"));
	});

	test("power_in + output -> no power_in error", () => {
		const pins = [pin("U1", "power_in"), pin("U2", "output")];
		const issues = checkNet(pins);
		assert.ok(!issues.some((i) => i.message === "power_in not driven"));
	});

	test("power_in + bidirectional -> no power_in error", () => {
		const pins = [pin("U1", "power_in"), pin("U2", "bidirectional")];
		const issues = checkNet(pins);
		assert.ok(!issues.some((i) => i.message === "power_in not driven"));
	});
});

describe("checkNet empty / no conflict", () => {
	test("empty pins -> no issues", () => {
		assert.deepEqual(checkNet([]), []);
	});

	test("passive + passive -> no issues", () => {
		const pins = [pin("R1", "passive"), pin("R2", "passive")];
		assert.deepEqual(checkNet(pins), []);
	});
});

describe("checkNet unspecified pins", () => {
	test("one warning per net listing every unspecified pin", () => {
		const pins = [
			pin("U1", "unspecified"),
			pin("U2", "unspecified"),
			pin("U3", "input"),
			pin("U4", "output"),
		];
		const found = checkNet(pins).filter((i) => i.message.includes("unspec"));
		assert.equal(found.length, 1);
		assert.equal(found[0].severity, "warning");
		assert.deepEqual(
			found[0].pins.map((p) => p.ref),
			["U1", "U2"],
		);
	});

	test("lone unspecified pin -> no warning", () => {
		assert.deepEqual(checkNet([pin("U1", "unspecified")]), []);
	});
});

// kicad-cli ERC treats same-named output pins of one symbol (a regulator's
// parallel SW pads) as one pin, but still flags differently named outputs
// and same-named power outputs (vme-wren power-supply demos).
// [case, [ref, type, name] of pin A, same for pin B, expected issue count]
const PARALLEL_OUTPUT_CASES = [
	[
		"same part, same name outputs",
		["U1", "output", "SW"],
		["U1", "output", "SW"],
		0,
	],
	[
		"same part, different names",
		["U1", "output", "A"],
		["U1", "output", "B"],
		1,
	],
	[
		"same name on different parts",
		["U1", "output", "SW"],
		["U2", "output", "SW"],
		1,
	],
	[
		"same part, same name power outputs",
		["U1", "power_out", "V"],
		["U1", "power_out", "V"],
		1,
	],
];

describe("checkNet parallel output pins of one part", () => {
	const named = ([ref, type, name]) => ({ ...pin(ref, type), name });
	for (const [name, a, b, count] of PARALLEL_OUTPUT_CASES) {
		test(`${name} -> ${count} issue(s)`, () => {
			assert.equal(checkNet([named(a), named(b)]).length, count);
		});
	}
});

describe("checkNet driven by something outside the pin list", () => {
	test("driven net skips undriven input and power_in checks", () => {
		const pins = [pin("U1", "input"), pin("U2", "power_in")];
		assert.deepEqual(checkNet(pins, { driven: true }), []);
	});

	test("driven net still reports pin-pair conflicts", () => {
		const pins = [pin("U1", "output"), pin("U2", "output")];
		assert.equal(checkNet(pins, { driven: true }).length, 1);
	});
});
