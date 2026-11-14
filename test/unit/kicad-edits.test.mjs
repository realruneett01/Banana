import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const at = (x, y, rot = 0, side = "F") => ({ x, y, rot, side });

const makePart = (patch = {}) =>
	Object.assign(
		{
			id: "part_1",
			ref: "R1",
			value: "10k",
			footprint: "Resistor_SMD:R_0603",
			placement: at(0, 0),
			props: {},
		},
		patch,
	);

const part = (id, ref, value) => makePart({ id, ref, value });

const makeNet = (patch = {}) =>
	Object.assign(
		{
			id: "net_1",
			name: "GND",
			pins: [{ partId: "part_1", pin: "1" }],
		},
		patch,
	);

const irWithParts = (...parts) => ({ parts, nets: [] });
const irWithNets = (...nets) => ({ parts: [], nets });
const singlePartIr = (patch = {}) => irWithParts(makePart(patch));

function freezeIr(partOverrides) {
	return Object.freeze({
		parts: [
			Object.freeze(
				makePart({
					...partOverrides,
					placement: Object.freeze(partOverrides.placement),
					props: Object.freeze({}),
				}),
			),
		],
		nets: [Object.freeze(makeNet({ pins: Object.freeze([]) }))],
	});
}

const moveCase = (name, beforeAt, afterAt, rot) => ({
	name,
	before: singlePartIr({ placement: beforeAt }),
	after: singlePartIr({ placement: afterAt }),
	canSaveInPlace: true,
	sch: [],
	pcb: [{ op: "move", ref: "R1", x: afterAt.x, y: afterAt.y, rot }],
	summary: "1 position will be saved",
});

const unsupp = (name, before, after, expectedSentence) => ({
	name,
	before,
	after,
	expectedSentence,
});

const emptyCase = (name, before, after) => ({
	name,
	before,
	after,
	canSaveInPlace: false,
	sch: [],
	pcb: [],
	summary: "Nothing to save",
});

const makeRefFixture = (vals) =>
	irWithParts(
		part("p3", "R3", vals[0]),
		part("p1", "R1", vals[1]),
		part("p2", "R2", vals[2]),
	);

const SUPPORTED_CASES = [
	{
		name: "value change produces setValue edit in both sch and pcb",
		before: singlePartIr({ value: "10k" }),
		after: singlePartIr({ value: "20k" }),
		canSaveInPlace: true,
		sch: [{ op: "setValue", ref: "R1", value: "20k" }],
		pcb: [{ op: "setValue", ref: "R1", value: "20k" }],
		summary: "1 value will be saved",
	},
	moveCase("move produces move edit in pcb only", at(0, 0), at(10, 20), 0),
	moveCase(
		"rot-only change produces move edit in pcb only",
		at(10, 20),
		at(10, 20, 90),
		90,
	),
	{
		name: "side flip produces a move edit carrying the new side",
		before: singlePartIr({ placement: at(0, 0) }),
		after: singlePartIr({ placement: at(0, 0, 0, "B") }),
		canSaveInPlace: true,
		sch: [],
		pcb: [{ op: "move", ref: "R1", x: 0, y: 0, rot: 0, side: "B" }],
		summary: "1 position will be saved",
	},
	{
		name: "value plus move on one part produces edits in both sch and pcb",
		before: singlePartIr({ value: "10k", placement: at(0, 0) }),
		after: singlePartIr({ value: "20k", placement: at(10, 20, 90) }),
		canSaveInPlace: true,
		sch: [{ op: "setValue", ref: "R1", value: "20k" }],
		pcb: [
			{ op: "move", ref: "R1", x: 10, y: 20, rot: 90 },
			{ op: "setValue", ref: "R1", value: "20k" },
		],
		summary: "1 value and 1 position will be saved",
	},
];

const UNSUPPORTED_CASES = [
	unsupp(
		"added part without library symbol unsupported",
		irWithParts(),
		singlePartIr({ id: "r5", ref: "R5" }),
		"R5 has no library symbol",
	),
	unsupp(
		"pin removed from a net unsupported",
		irWithNets(
			makeNet({
				id: "n1",
				name: "VCC",
				pins: [
					{ partId: "p1", pin: "1" },
					{ partId: "p2", pin: "2" },
				],
			}),
		),
		irWithNets(
			makeNet({
				id: "n1",
				name: "VCC",
				pins: [{ partId: "p1", pin: "1" }],
			}),
		),
		"connection VCC lost a pin",
	),
	unsupp(
		"non-finite coordinates unsupported",
		singlePartIr({ id: "r1", ref: "R1", placement: at(0, 0) }),
		singlePartIr({ id: "r1", ref: "R1", placement: at(Number.NaN, 0) }),
		"R1 has non-finite coordinates",
	),
];

const unchangedIr = { parts: [makePart()], nets: [makeNet()] };
const EMPTY_CASES = [
	emptyCase(
		"no change returns canSaveInPlace false and Nothing to save",
		unchangedIr,
		unchangedIr,
	),
	emptyCase(
		"null inputs return canSaveInPlace false and Nothing to save",
		null,
		null,
	),
];

function runEditCase(tc) {
	test(tc.name, () => {
		const res = editsFromIrChange(tc.before, tc.after);
		assert.equal(res.canSaveInPlace, tc.canSaveInPlace);
		assert.equal(res.summary, tc.summary);
		assert.deepEqual(res.sch, tc.sch);
		assert.deepEqual(res.pcb, tc.pcb);
		assert.deepEqual(res.unsupported, []);
	});
}

function runUnsupportedCase(tc) {
	test(`unsupported case: ${tc.name}`, () => {
		const res = editsFromIrChange(tc.before, tc.after);
		assert.equal(res.canSaveInPlace, false);
		assert.equal(res.summary, "Nothing to save");
		assert.ok(res.unsupported.includes(tc.expectedSentence));
	});
}

describe("kicadEdits - supported in-place edits", () => {
	for (const tc of SUPPORTED_CASES) {
		runEditCase(tc);
	}

	test("deterministic order sorts edits by ref", () => {
		const before = makeRefFixture(["30k", "10k", "20k"]);
		const after = makeRefFixture(["33k", "11k", "22k"]);
		const res = editsFromIrChange(before, after);
		const orderedRefs = ["R1", "R2", "R3"];
		assert.equal(res.summary, "3 values will be saved");
		for (const edits of [res.sch, res.pcb]) {
			assert.deepEqual(
				edits.map((e) => e.ref),
				orderedRefs,
			);
		}
	});

	test("inputs are not mutated", () => {
		const before = freezeIr({ value: "10k", placement: at(0, 0) });
		const after = freezeIr({ value: "20k", placement: at(10, 10) });
		const res = editsFromIrChange(before, after);
		assert.equal(res.canSaveInPlace, true);
		for (const [actual, expected] of [
			[before.parts[0].value, "10k"],
			[after.parts[0].value, "20k"],
		]) {
			assert.equal(actual, expected);
		}
	});
});

describe("kicadEdits - unsupported and edge cases", () => {
	for (const tc of UNSUPPORTED_CASES) {
		runUnsupportedCase(tc);
	}

	for (const tc of EMPTY_CASES) {
		runEditCase(tc);
	}
});
