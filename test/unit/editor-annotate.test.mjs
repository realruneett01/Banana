import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	annotate,
	findDuplicateRefs,
	refNumber,
	refPrefix,
} from "../../frontend/src/editor/annotate.js";

function makePart(id, ref, x = 0, y = 0) {
	return {
		id,
		ref,
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603",
		props: {},
		placement: { x, y, rot: 0, side: "F" },
	};
}

const REF_PREFIX_CASES = [
	{ ref: "R?", expected: "R" },
	{ ref: "U12", expected: "U" },
	{ ref: "SW_1", expected: "SW_" },
	{ ref: "#PWR1", expected: "#PWR" },
	{ ref: "C", expected: "C" },
	{ ref: "12", expected: "X" },
	{ ref: "?", expected: "X" },
	{ ref: "", expected: "X" },
	{ ref: null, expected: "X" },
	{ ref: undefined, expected: "X" },
];

const REF_NUMBER_CASES = [
	{ ref: "R12", expected: 12 },
	{ ref: "U3", expected: 3 },
	{ ref: "SW_1", expected: 1 },
	{ ref: "R0", expected: 0 },
	{ ref: "123", expected: 123 },
	{ ref: "R?", expected: null },
	{ ref: "R", expected: null },
	{ ref: "R12?", expected: null },
	{ ref: "", expected: null },
	{ ref: null, expected: null },
];

const DUPLICATE_REF_CASES = [
	{
		parts: [makePart("p1", "R1"), makePart("p2", "R2")],
		expected: [],
	},
	{
		parts: [makePart("p1", "R1"), makePart("p2", "R1"), makePart("p3", "R2")],
		expected: ["R1"],
	},
	{
		parts: [
			makePart("p1", "R1"),
			makePart("p2", "C1"),
			makePart("p3", "R1"),
			makePart("p4", "C1"),
		],
		expected: ["R1", "C1"],
	},
	{
		parts: [],
		expected: [],
	},
];

const ANNOTATE_TABLE_CASES = [
	{
		name: "default options with unannotated parts",
		ir: { parts: [makePart("p1", "C?"), makePart("p2", "C?")] },
		opts: undefined,
		expectedRefs: ["C1", "C2"],
	},
	{
		name: "keep mode skips existing numbers and handles non-standard prefixes",
		ir: { parts: [makePart("p1", "SW_1"), makePart("p2", "SW_?")] },
		opts: { mode: "keep", start: 1 },
		expectedRefs: ["SW_1", "SW_2"],
	},
	{
		name: "empty ir handles gracefully",
		ir: { parts: [] },
		opts: {},
		expectedRefs: [],
	},
];

describe("annotate module", () => {
	test("refPrefix extracts prefix according to rules", () => {
		for (const { ref, expected } of REF_PREFIX_CASES) {
			assert.equal(refPrefix(ref), expected);
		}
	});

	test("refNumber extracts trailing integer or null", () => {
		for (const { ref, expected } of REF_NUMBER_CASES) {
			assert.equal(refNumber(ref), expected);
		}
	});

	test("findDuplicateRefs identifies repeated references", () => {
		for (const { parts, expected } of DUPLICATE_REF_CASES) {
			assert.deepEqual(findDuplicateRefs({ parts }), expected);
		}
	});

	test("keep mode fills gaps in x order", () => {
		const ir = {
			parts: [
				makePart("p1", "R1", 0, 0),
				makePart("p2", "R?", 10, 0),
				makePart("p3", "R3", 20, 0),
				makePart("p4", "R?", 30, 0),
			],
		};
		const res = annotate(ir, { mode: "keep", order: "x", start: 1 });
		const refs = res.ir.parts.map((p) => p.ref);
		assert.deepEqual(refs, ["R1", "R2", "R3", "R4"]);
	});

	test("reset mode renumbers by position", () => {
		const ir = {
			parts: [
				makePart("p1", "R9", 30, 0),
				makePart("p2", "R1", 10, 0),
				makePart("p3", "R?", 20, 0),
			],
		};
		const res = annotate(ir, { mode: "reset", order: "x", start: 1 });
		assert.deepEqual(
			res.ir.parts.map((p) => ({ id: p.id, ref: p.ref })),
			[
				{ id: "p1", ref: "R3" },
				{ id: "p2", ref: "R1" },
				{ id: "p3", ref: "R2" },
			],
		);
	});

	test("order y sorts primarily by y coordinate", () => {
		const ir = {
			parts: [
				makePart("p1", "R?", 10, 50),
				makePart("p2", "R?", 30, 10),
				makePart("p3", "R?", 20, 10),
			],
		};
		const res = annotate(ir, { mode: "reset", order: "y", start: 1 });
		assert.deepEqual(
			res.ir.parts.map((p) => ({ id: p.id, ref: p.ref })),
			[
				{ id: "p1", ref: "R3" },
				{ id: "p2", ref: "R2" },
				{ id: "p3", ref: "R1" },
			],
		);
	});

	test("start 100 begins numbering at 100", () => {
		const ir = {
			parts: [makePart("p1", "R?", 10, 0), makePart("p2", "R?", 20, 0)],
		};
		const res = annotate(ir, { mode: "reset", order: "x", start: 100 });
		assert.deepEqual(
			res.ir.parts.map((p) => p.ref),
			["R100", "R101"],
		);
	});

	test("mixed prefixes allocate separate number sequences", () => {
		const ir = {
			parts: [
				makePart("p1", "R?", 10, 0),
				makePart("p2", "C?", 20, 0),
				makePart("p3", "U?", 30, 0),
				makePart("p4", "R?", 40, 0),
				makePart("p5", "C?", 50, 0),
			],
		};
		const res = annotate(ir, { mode: "reset", order: "x", start: 1 });
		assert.deepEqual(
			res.ir.parts.map((p) => p.ref),
			["R1", "C1", "U1", "R2", "C2"],
		);
	});

	test("input ir and parts are not mutated", () => {
		const p1 = makePart("p1", "R?", 10, 0);
		const p2 = makePart("p2", "R?", 20, 0);
		const ir = { parts: [p1, p2], nets: [{ id: "n1", name: "GND" }] };
		Object.freeze(p1);
		Object.freeze(p2);
		Object.freeze(ir.parts);
		Object.freeze(ir);
		const res = annotate(ir, { mode: "keep", order: "x", start: 1 });
		assert.notEqual(res.ir, ir);
		assert.notEqual(res.ir.parts, ir.parts);
		assert.equal(ir.parts[0].ref, "R?");
		assert.equal(ir.parts[1].ref, "R?");
		assert.equal(res.ir.parts[0].ref, "R1");
		assert.equal(res.ir.parts[1].ref, "R2");
	});

	test("changes list records modified parts with id, from, and to", () => {
		const ir = {
			parts: [
				makePart("p1", "R1", 0, 0),
				makePart("p2", "R?", 10, 0),
				makePart("p3", "R?", 20, 0),
			],
		};
		const res = annotate(ir, { mode: "keep", order: "x", start: 1 });
		assert.deepEqual(res.changes, [
			{ id: "p2", from: "R?", to: "R2" },
			{ id: "p3", from: "R?", to: "R3" },
		]);
	});

	test("annotate parameterized options", () => {
		for (const c of ANNOTATE_TABLE_CASES) {
			const res = annotate(c.ir, c.opts);
			assert.deepEqual(
				res.ir.parts.map((p) => p.ref),
				c.expectedRefs,
			);
		}
	});
});
