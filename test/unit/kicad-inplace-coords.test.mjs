import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { parse, serialize } from "../../backend/src/engine/sexpr.js";

function createPcbFixture() {
	const text = `(kicad_pcb
	(version 20240108)
	(footprint "Resistor_SMD:R_0603"
		(layer "F.Cu")
		(at 10 20 45)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;
	return {
		pcbText: text,
		unchangedText: serialize(parse(text)),
	};
}

const fixture = createPcbFixture();

function moveFootprint(fields) {
	return patchKicadText(fixture.pcbText, {
		kind: "pcb",
		edits: [{ op: "move", ref: "R1", x: 1, y: 2, ...fields }],
	});
}

function verifyRejectedMove(field, value) {
	const res = moveFootprint({ [field]: value });
	assert.equal(res.ok, true);
	assert.equal(res.applied, 0);
	assert.equal(res.skipped.length, 1);
	assert.match(res.skipped[0].reason, /Invalid coordinates/);
	assert.equal(res.text, fixture.unchangedText);
}

function verifyAcceptedMove(fields, expectedPattern) {
	const res = moveFootprint(fields);
	assert.equal(res.applied, 1);
	assert.match(res.text, expectedPattern);
}

const REJECTED_COORDINATES = [
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

const ACCEPTED_COORDINATES = [
	{
		name: "accepts 9999.5 on both axes",
		fields: { x: 9999.5, y: -9999.5, rot: 90 },
		expectedPattern: /\(at 9999\.5 -9999\.5 90\)/,
	},
	{
		name: "accepts normal values and the 10000 mm boundary",
		fields: { x: 10000, y: 12.25 },
		expectedPattern: /\(at 10000 12\.25 45\)/,
	},
];

describe("legacy move coordinate limits", () => {
	for (const [field, value] of REJECTED_COORDINATES) {
		test(`rejects ${field}=${String(value)} and leaves the file unchanged`, () => {
			verifyRejectedMove(field, value);
		});
	}

	for (const { name, fields, expectedPattern } of ACCEPTED_COORDINATES) {
		test(name, () => {
			verifyAcceptedMove(fields, expectedPattern);
		});
	}
});
