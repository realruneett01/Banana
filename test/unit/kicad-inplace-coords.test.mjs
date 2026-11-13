import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { parse, serialize } from "../../backend/src/engine/sexpr.js";

const PCB = `(kicad_pcb
	(version 20240108)
	(footprint "Resistor_SMD:R_0603"
		(layer "F.Cu")
		(at 10 20 45)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

const UNCHANGED = serialize(parse(PCB));

function move(fields) {
	return patchKicadText(PCB, {
		kind: "pcb",
		edits: [{ op: "move", ref: "R1", x: 1, y: 2, ...fields }],
	});
}

const REJECTED = [
	["x", 1e308],
	["x", -1e308],
	["y", Number.NaN],
	["y", Number.POSITIVE_INFINITY],
	["x", "12"],
	["x", 10001],
	["y", -10001],
	["rot", Number.NEGATIVE_INFINITY],
	["rot", Number.NaN],
];

describe("legacy move coordinate limits", () => {
	for (const [field, value] of REJECTED) {
		test(`rejects ${field}=${String(value)} and leaves the file unchanged`, () => {
			const res = move({ [field]: value });
			assert.equal(res.ok, true);
			assert.equal(res.applied, 0);
			assert.equal(res.skipped.length, 1);
			assert.match(res.skipped[0].reason, /Invalid coordinates/);
			assert.equal(res.text, UNCHANGED);
		});
	}

	test("accepts 9999.5 on both axes", () => {
		const res = move({ x: 9999.5, y: -9999.5, rot: 90 });
		assert.equal(res.applied, 1);
		assert.match(res.text, /\(at 9999\.5 -9999\.5 90\)/);
	});

	test("accepts normal values and the 10000 mm boundary", () => {
		const res = move({ x: 10000, y: 12.25 });
		assert.equal(res.applied, 1);
		assert.match(res.text, /\(at 10000 12\.25 45\)/);
	});
});
