import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const makePart = (patch = {}) =>
	Object.assign(
		{
			id: "part_1",
			ref: "R1",
			value: "10k",
			footprint: "Resistor_SMD:R_0603",
			placement: { x: 0, y: 0, rot: 0, side: "F" },
			props: {},
		},
		patch,
	);

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

function assertExpectedEdits(res, expected) {
	assert.equal(res.canSaveInPlace, true);
	assert.deepEqual(res.unsupported, []);
	assert.deepEqual(res.sch, expected.sch);
	assert.deepEqual(res.pcb, expected.pcb);
	assert.equal(res.summary, expected.summary);
}

function assertNoEdits(res) {
	assert.equal(res.canSaveInPlace, false);
	assert.equal(res.summary, "Nothing to save");
}

function assertEmptyEdits(res) {
	assertNoEdits(res);
	assert.deepEqual(res.sch, []);
	assert.deepEqual(res.pcb, []);
	assert.deepEqual(res.unsupported, []);
}

function assertUnsupported(res, expectedSentence) {
	assertNoEdits(res);
	assert.ok(res.unsupported.includes(expectedSentence));
}

const SUPPORTED_CASES = [
	{
		name: "value change produces setValue edit in both sch and pcb",
		before: irWithParts(makePart({ value: "10k" })),
		after: irWithParts(makePart({ value: "20k" })),
		sch: [{ op: "setValue", ref: "R1", value: "20k" }],
		pcb: [{ op: "setValue", ref: "R1", value: "20k" }],
		summary: "1 value will be saved",
	},
	{
		name: "move produces move edit in pcb only",
		before: irWithParts(
			makePart({ placement: { x: 0, y: 0, rot: 0, side: "F" } }),
		),
		after: irWithParts(
			makePart({ placement: { x: 10, y: 20, rot: 0, side: "F" } }),
		),
		sch: [],
		pcb: [{ op: "move", ref: "R1", x: 10, y: 20, rot: 0 }],
		summary: "1 position will be saved",
	},
	{
		name: "rot-only change produces move edit in pcb only",
		before: irWithParts(
			makePart({ placement: { x: 10, y: 20, rot: 0, side: "F" } }),
		),
		after: irWithParts(
			makePart({ placement: { x: 10, y: 20, rot: 90, side: "F" } }),
		),
		sch: [],
		pcb: [{ op: "move", ref: "R1", x: 10, y: 20, rot: 90 }],
		summary: "1 position will be saved",
	},
	{
		name: "value plus move on one part produces edits in both sch and pcb",
		before: irWithParts(
			makePart({
				value: "10k",
				placement: { x: 0, y: 0, rot: 0, side: "F" },
			}),
		),
		after: irWithParts(
			makePart({
				value: "20k",
				placement: { x: 10, y: 20, rot: 90, side: "F" },
			}),
		),
		sch: [{ op: "setValue", ref: "R1", value: "20k" }],
		pcb: [
			{ op: "move", ref: "R1", x: 10, y: 20, rot: 90 },
			{ op: "setValue", ref: "R1", value: "20k" },
		],
		summary: "1 value and 1 position will be saved",
	},
];

const UNSUPPORTED_CASES = [
	{
		name: "side flip unsupported",
		before: irWithParts(
			makePart({
				id: "d1",
				ref: "D1",
				placement: { x: 0, y: 0, rot: 0, side: "F" },
			}),
		),
		after: irWithParts(
			makePart({
				id: "d1",
				ref: "D1",
				placement: { x: 0, y: 0, rot: 0, side: "B" },
			}),
		),
		expectedSentence: "D1 moved to the other side of the board",
	},
	{
		name: "added part unsupported",
		before: irWithParts(),
		after: irWithParts(makePart({ id: "r5", ref: "R5" })),
		expectedSentence: "R5 was added",
	},
	{
		name: "removed part unsupported",
		before: irWithParts(makePart({ id: "c2", ref: "C2" })),
		after: irWithParts(),
		expectedSentence: "C2 was removed",
	},
	{
		name: "renamed part unsupported",
		before: irWithParts(makePart({ id: "p1", ref: "R1" })),
		after: irWithParts(makePart({ id: "p1", ref: "R10" })),
		expectedSentence: "R1 was renamed to R10",
	},
	{
		name: "footprint change unsupported",
		before: irWithParts(makePart({ id: "u1", ref: "U1", footprint: "SOIC-8" })),
		after: irWithParts(makePart({ id: "u1", ref: "U1", footprint: "TSSOP-8" })),
		expectedSentence: "U1 changed footprint",
	},
	{
		name: "net change unsupported",
		before: irWithNets(
			makeNet({
				id: "n1",
				name: "VCC",
				pins: [{ partId: "p1", pin: "1" }],
			}),
		),
		after: irWithNets(
			makeNet({
				id: "n1",
				name: "VCC",
				pins: [
					{ partId: "p1", pin: "1" },
					{ partId: "p2", pin: "2" },
				],
			}),
		),
		expectedSentence: "connection VCC changed",
	},
	{
		name: "non-finite coordinates unsupported",
		before: irWithParts(
			makePart({
				id: "r1",
				ref: "R1",
				placement: { x: 0, y: 0, rot: 0, side: "F" },
			}),
		),
		after: irWithParts(
			makePart({
				id: "r1",
				ref: "R1",
				placement: { x: Number.NaN, y: 0, rot: 0, side: "F" },
			}),
		),
		expectedSentence: "R1 has non-finite coordinates",
	},
];

describe("kicadEdits - supported in-place edits", () => {
	for (const tc of SUPPORTED_CASES) {
		test(tc.name, () => {
			assertExpectedEdits(editsFromIrChange(tc.before, tc.after), tc);
		});
	}

	test("deterministic order sorts edits by ref", () => {
		const before = irWithParts(
			makePart({ id: "p3", ref: "R3", value: "30k" }),
			makePart({ id: "p1", ref: "R1", value: "10k" }),
			makePart({ id: "p2", ref: "R2", value: "20k" }),
		);
		const after = irWithParts(
			makePart({ id: "p3", ref: "R3", value: "33k" }),
			makePart({ id: "p1", ref: "R1", value: "11k" }),
			makePart({ id: "p2", ref: "R2", value: "22k" }),
		);
		const res = editsFromIrChange(before, after);
		const orderedRefs = ["R1", "R2", "R3"];
		assert.deepEqual(
			res.sch.map((e) => e.ref),
			orderedRefs,
		);
		assert.deepEqual(
			res.pcb.map((e) => e.ref),
			orderedRefs,
		);
		assert.equal(res.summary, "3 values will be saved");
	});

	test("inputs are not mutated", () => {
		const before = freezeIr({
			value: "10k",
			placement: { x: 0, y: 0, rot: 0, side: "F" },
		});
		const after = freezeIr({
			value: "20k",
			placement: { x: 10, y: 10, rot: 0, side: "F" },
		});
		const res = editsFromIrChange(before, after);
		assert.equal(res.canSaveInPlace, true);
		assert.equal(before.parts[0].value, "10k");
		assert.equal(after.parts[0].value, "20k");
	});
});

describe("kicadEdits - unsupported and edge cases", () => {
	for (const tc of UNSUPPORTED_CASES) {
		test(`unsupported case: ${tc.name}`, () => {
			assertUnsupported(
				editsFromIrChange(tc.before, tc.after),
				tc.expectedSentence,
			);
		});
	}

	test("no change returns canSaveInPlace false and Nothing to save", () => {
		const ir = { parts: [makePart()], nets: [makeNet()] };
		assertEmptyEdits(editsFromIrChange(ir, ir));
	});

	test("null inputs return canSaveInPlace false and Nothing to save", () => {
		assertEmptyEdits(editsFromIrChange(null, null));
	});
});
