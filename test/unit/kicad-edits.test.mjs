import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

function makePart(overrides = {}) {
	return {
		id: "part_1",
		ref: "R1",
		value: "10k",
		footprint: "Resistor_SMD:R_0603",
		placement: { x: 0, y: 0, rot: 0, side: "F" },
		props: {},
		...overrides,
	};
}

function makeNet(overrides = {}) {
	return {
		id: "net_1",
		name: "GND",
		pins: [{ partId: "part_1", pin: "1" }],
		...overrides,
	};
}

const UNSUPPORTED_CASES = [
	{
		name: "side flip unsupported",
		before: {
			parts: [
				makePart({
					id: "d1",
					ref: "D1",
					placement: { x: 0, y: 0, rot: 0, side: "F" },
				}),
			],
			nets: [],
		},
		after: {
			parts: [
				makePart({
					id: "d1",
					ref: "D1",
					placement: { x: 0, y: 0, rot: 0, side: "B" },
				}),
			],
			nets: [],
		},
		expectedSentence: "D1 moved to the other side of the board",
	},
	{
		name: "added part unsupported",
		before: { parts: [], nets: [] },
		after: { parts: [makePart({ id: "r5", ref: "R5" })], nets: [] },
		expectedSentence: "R5 was added",
	},
	{
		name: "removed part unsupported",
		before: { parts: [makePart({ id: "c2", ref: "C2" })], nets: [] },
		after: { parts: [], nets: [] },
		expectedSentence: "C2 was removed",
	},
	{
		name: "renamed part unsupported",
		before: { parts: [makePart({ id: "p1", ref: "R1" })], nets: [] },
		after: { parts: [makePart({ id: "p1", ref: "R10" })], nets: [] },
		expectedSentence: "R1 was renamed to R10",
	},
	{
		name: "footprint change unsupported",
		before: {
			parts: [makePart({ id: "u1", ref: "U1", footprint: "SOIC-8" })],
			nets: [],
		},
		after: {
			parts: [makePart({ id: "u1", ref: "U1", footprint: "TSSOP-8" })],
			nets: [],
		},
		expectedSentence: "U1 changed footprint",
	},
	{
		name: "net change unsupported",
		before: {
			parts: [],
			nets: [
				makeNet({
					id: "n1",
					name: "VCC",
					pins: [{ partId: "p1", pin: "1" }],
				}),
			],
		},
		after: {
			parts: [],
			nets: [
				makeNet({
					id: "n1",
					name: "VCC",
					pins: [
						{ partId: "p1", pin: "1" },
						{ partId: "p2", pin: "2" },
					],
				}),
			],
		},
		expectedSentence: "connection VCC changed",
	},
	{
		name: "non-finite coordinates unsupported",
		before: {
			parts: [
				makePart({
					id: "r1",
					ref: "R1",
					placement: { x: 0, y: 0, rot: 0, side: "F" },
				}),
			],
			nets: [],
		},
		after: {
			parts: [
				makePart({
					id: "r1",
					ref: "R1",
					placement: { x: Number.NaN, y: 0, rot: 0, side: "F" },
				}),
			],
			nets: [],
		},
		expectedSentence: "R1 has non-finite coordinates",
	},
];

describe("kicadEdits - supported in-place edits", () => {
	test("value change produces setValue edit in both sch and pcb", () => {
		const before = { parts: [makePart({ value: "10k" })], nets: [] };
		const after = { parts: [makePart({ value: "20k" })], nets: [] };
		const res = editsFromIrChange(before, after);
		assert.equal(res.canSaveInPlace, true);
		assert.deepEqual(res.unsupported, []);
		assert.deepEqual(res.sch, [{ op: "setValue", ref: "R1", value: "20k" }]);
		assert.deepEqual(res.pcb, [{ op: "setValue", ref: "R1", value: "20k" }]);
		assert.equal(res.summary, "1 value will be saved");
	});

	test("move produces move edit in pcb only", () => {
		const before = {
			parts: [makePart({ placement: { x: 0, y: 0, rot: 0, side: "F" } })],
			nets: [],
		};
		const after = {
			parts: [makePart({ placement: { x: 10, y: 20, rot: 0, side: "F" } })],
			nets: [],
		};
		const res = editsFromIrChange(before, after);
		assert.equal(res.canSaveInPlace, true);
		assert.deepEqual(res.unsupported, []);
		assert.deepEqual(res.sch, []);
		assert.deepEqual(res.pcb, [
			{ op: "move", ref: "R1", x: 10, y: 20, rot: 0 },
		]);
		assert.equal(res.summary, "1 position will be saved");
	});

	test("rot-only change produces move edit in pcb only", () => {
		const before = {
			parts: [makePart({ placement: { x: 10, y: 20, rot: 0, side: "F" } })],
			nets: [],
		};
		const after = {
			parts: [makePart({ placement: { x: 10, y: 20, rot: 90, side: "F" } })],
			nets: [],
		};
		const res = editsFromIrChange(before, after);
		assert.equal(res.canSaveInPlace, true);
		assert.deepEqual(res.unsupported, []);
		assert.deepEqual(res.sch, []);
		assert.deepEqual(res.pcb, [
			{ op: "move", ref: "R1", x: 10, y: 20, rot: 90 },
		]);
		assert.equal(res.summary, "1 position will be saved");
	});

	test("value plus move on one part produces edits in both sch and pcb", () => {
		const before = {
			parts: [
				makePart({
					value: "10k",
					placement: { x: 0, y: 0, rot: 0, side: "F" },
				}),
			],
			nets: [],
		};
		const after = {
			parts: [
				makePart({
					value: "20k",
					placement: { x: 10, y: 20, rot: 90, side: "F" },
				}),
			],
			nets: [],
		};
		const res = editsFromIrChange(before, after);
		assert.equal(res.canSaveInPlace, true);
		assert.deepEqual(res.unsupported, []);
		assert.deepEqual(res.sch, [{ op: "setValue", ref: "R1", value: "20k" }]);
		assert.deepEqual(res.pcb, [
			{ op: "move", ref: "R1", x: 10, y: 20, rot: 90 },
			{ op: "setValue", ref: "R1", value: "20k" },
		]);
		assert.equal(res.summary, "1 value and 1 position will be saved");
	});

	test("deterministic order sorts edits by ref", () => {
		const before = {
			parts: [
				makePart({ id: "p3", ref: "R3", value: "30k" }),
				makePart({ id: "p1", ref: "R1", value: "10k" }),
				makePart({ id: "p2", ref: "R2", value: "20k" }),
			],
			nets: [],
		};
		const after = {
			parts: [
				makePart({ id: "p3", ref: "R3", value: "33k" }),
				makePart({ id: "p1", ref: "R1", value: "11k" }),
				makePart({ id: "p2", ref: "R2", value: "22k" }),
			],
			nets: [],
		};
		const res = editsFromIrChange(before, after);
		assert.deepEqual(
			res.sch.map((e) => e.ref),
			["R1", "R2", "R3"],
		);
		assert.deepEqual(
			res.pcb.map((e) => e.ref),
			["R1", "R2", "R3"],
		);
		assert.equal(res.summary, "3 values will be saved");
	});

	test("inputs are not mutated", () => {
		const before = Object.freeze({
			parts: [
				Object.freeze(
					makePart({
						value: "10k",
						placement: Object.freeze({ x: 0, y: 0, rot: 0, side: "F" }),
						props: Object.freeze({}),
					}),
				),
			],
			nets: [Object.freeze(makeNet({ pins: Object.freeze([]) }))],
		});
		const after = Object.freeze({
			parts: [
				Object.freeze(
					makePart({
						value: "20k",
						placement: Object.freeze({ x: 10, y: 10, rot: 0, side: "F" }),
						props: Object.freeze({}),
					}),
				),
			],
			nets: [Object.freeze(makeNet({ pins: Object.freeze([]) }))],
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
			const res = editsFromIrChange(tc.before, tc.after);
			assert.equal(res.canSaveInPlace, false);
			assert.equal(res.summary, "Nothing to save");
			assert.ok(res.unsupported.includes(tc.expectedSentence));
		});
	}

	test("no change returns canSaveInPlace false and Nothing to save", () => {
		const ir = { parts: [makePart()], nets: [makeNet()] };
		const res = editsFromIrChange(ir, ir);
		assert.equal(res.canSaveInPlace, false);
		assert.deepEqual(res.sch, []);
		assert.deepEqual(res.pcb, []);
		assert.deepEqual(res.unsupported, []);
		assert.equal(res.summary, "Nothing to save");
	});

	test("null inputs return canSaveInPlace false and Nothing to save", () => {
		const res = editsFromIrChange(null, null);
		assert.equal(res.canSaveInPlace, false);
		assert.deepEqual(res.sch, []);
		assert.deepEqual(res.pcb, []);
		assert.deepEqual(res.unsupported, []);
		assert.equal(res.summary, "Nothing to save");
	});
});
