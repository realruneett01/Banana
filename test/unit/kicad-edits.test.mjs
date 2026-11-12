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

const SUPPORTED_CASES = [
	{
		name: "value change produces setValue edit in both sch and pcb",
		before: singlePartIr({ value: "10k" }),
		after: singlePartIr({ value: "20k" }),
		sch: [{ op: "setValue", ref: "R1", value: "20k" }],
		pcb: [{ op: "setValue", ref: "R1", value: "20k" }],
		summary: "1 value will be saved",
	},
	{
		name: "move produces move edit in pcb only",
		before: singlePartIr({ placement: at(0, 0) }),
		after: singlePartIr({ placement: at(10, 20) }),
		sch: [],
		pcb: [{ op: "move", ref: "R1", x: 10, y: 20, rot: 0 }],
		summary: "1 position will be saved",
	},
	{
		name: "rot-only change produces move edit in pcb only",
		before: singlePartIr({ placement: at(10, 20) }),
		after: singlePartIr({ placement: at(10, 20, 90) }),
		sch: [],
		pcb: [{ op: "move", ref: "R1", x: 10, y: 20, rot: 90 }],
		summary: "1 position will be saved",
	},
	{
		name: "value plus move on one part produces edits in both sch and pcb",
		before: singlePartIr({ value: "10k", placement: at(0, 0) }),
		after: singlePartIr({ value: "20k", placement: at(10, 20, 90) }),
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
		before: singlePartIr({ id: "d1", ref: "D1", placement: at(0, 0) }),
		after: singlePartIr({ id: "d1", ref: "D1", placement: at(0, 0, 0, "B") }),
		expectedSentence: "D1 moved to the other side of the board",
	},
	{
		name: "added part unsupported",
		before: irWithParts(),
		after: singlePartIr({ id: "r5", ref: "R5" }),
		expectedSentence: "R5 was added",
	},
	{
		name: "removed part unsupported",
		before: singlePartIr({ id: "c2", ref: "C2" }),
		after: irWithParts(),
		expectedSentence: "C2 was removed",
	},
	{
		name: "renamed part unsupported",
		before: singlePartIr({ id: "p1", ref: "R1" }),
		after: singlePartIr({ id: "p1", ref: "R10" }),
		expectedSentence: "R1 was renamed to R10",
	},
	{
		name: "footprint change unsupported",
		before: singlePartIr({ id: "u1", ref: "U1", footprint: "SOIC-8" }),
		after: singlePartIr({ id: "u1", ref: "U1", footprint: "TSSOP-8" }),
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
		before: singlePartIr({ id: "r1", ref: "R1", placement: at(0, 0) }),
		after: singlePartIr({ id: "r1", ref: "R1", placement: at(Number.NaN, 0) }),
		expectedSentence: "R1 has non-finite coordinates",
	},
];

const unchangedIr = { parts: [makePart()], nets: [makeNet()] };
const EMPTY_CASES = [
	{
		name: "no change returns canSaveInPlace false and Nothing to save",
		before: unchangedIr,
		after: unchangedIr,
	},
	{
		name: "null inputs return canSaveInPlace false and Nothing to save",
		before: null,
		after: null,
	},
];

describe("kicadEdits - supported in-place edits", () => {
	for (const tc of SUPPORTED_CASES) {
		test(tc.name, () => {
			const res = editsFromIrChange(tc.before, tc.after);
			assert.deepEqual(res.sch, tc.sch);
			assert.equal(res.canSaveInPlace, true);
			assert.deepEqual(res.pcb, tc.pcb);
			assert.equal(res.summary, tc.summary);
			assert.deepEqual(res.unsupported, []);
		});
	}

	test("deterministic order sorts edits by ref", () => {
		const before = irWithParts(
			part("p3", "R3", "30k"),
			part("p1", "R1", "10k"),
			part("p2", "R2", "20k"),
		);
		const after = irWithParts(
			part("p3", "R3", "33k"),
			part("p1", "R1", "11k"),
			part("p2", "R2", "22k"),
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
			placement: at(0, 0),
		});
		const after = freezeIr({
			value: "20k",
			placement: at(10, 10),
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
			assert.ok(res.unsupported.includes(tc.expectedSentence));
			assert.equal(res.summary, "Nothing to save");
		});
	}

	for (const tc of EMPTY_CASES) {
		test(tc.name, () => {
			const res = editsFromIrChange(tc.before, tc.after);
			assert.equal(res.canSaveInPlace, false);
			assert.deepEqual(res.sch, []);
			assert.equal(res.summary, "Nothing to save");
			assert.deepEqual(res.pcb, []);
			assert.deepEqual(res.unsupported, []);
		});
	}
});
