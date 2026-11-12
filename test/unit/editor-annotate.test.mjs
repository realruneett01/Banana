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

function makeFrozenFixture() {
	const p1 = makePart("p1", "R?", 10, 0);
	const p2 = makePart("p2", "R?", 20, 0);
	const ir = { parts: [p1, p2], nets: [{ id: "n1", name: "GND" }] };
	Object.freeze(p1);
	Object.freeze(p2);
	Object.freeze(ir.parts);
	Object.freeze(ir);
	return { ir, res: annotate(ir, { mode: "keep", order: "x", start: 1 }) };
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

const ANNOTATE_CASES = [
	{
		name: "default options with unannotated parts",
		ir: { parts: [makePart("p1", "C?"), makePart("p2", "C?")] },
		opts: undefined,
		expected: ["C1", "C2"],
	},
	{
		name: "keep mode skips existing numbers and handles non-standard prefixes",
		ir: { parts: [makePart("p1", "SW_1"), makePart("p2", "SW_?")] },
		opts: { mode: "keep", start: 1 },
		expected: ["SW_1", "SW_2"],
	},
	{
		name: "empty ir handles gracefully",
		ir: { parts: [] },
		opts: {},
		expected: [],
	},
	{
		name: "keep mode fills gaps in x order",
		ir: {
			parts: [
				makePart("p1", "R1", 0, 0),
				makePart("p2", "R?", 10, 0),
				makePart("p3", "R3", 20, 0),
				makePart("p4", "R?", 30, 0),
			],
		},
		opts: { mode: "keep", order: "x", start: 1 },
		expected: ["R1", "R2", "R3", "R4"],
	},
	{
		name: "reset mode renumbers by position",
		ir: {
			parts: [
				makePart("p1", "R9", 30, 0),
				makePart("p2", "R1", 10, 0),
				makePart("p3", "R?", 20, 0),
			],
		},
		opts: { mode: "reset", order: "x", start: 1 },
		expected: [
			{ id: "p1", ref: "R3" },
			{ id: "p2", ref: "R1" },
			{ id: "p3", ref: "R2" },
		],
		extract: (res) => res.ir.parts.map((p) => ({ id: p.id, ref: p.ref })),
	},
	{
		name: "order y sorts primarily by y coordinate",
		ir: {
			parts: [
				makePart("p1", "R?", 10, 50),
				makePart("p2", "R?", 30, 10),
				makePart("p3", "R?", 20, 10),
			],
		},
		opts: { mode: "reset", order: "y", start: 1 },
		expected: [
			{ id: "p1", ref: "R3" },
			{ id: "p2", ref: "R2" },
			{ id: "p3", ref: "R1" },
		],
		extract: (res) => res.ir.parts.map((p) => ({ id: p.id, ref: p.ref })),
	},
	{
		name: "start 100 begins numbering at 100",
		ir: {
			parts: [makePart("p1", "R?", 10, 0), makePart("p2", "R?", 20, 0)],
		},
		opts: { mode: "reset", order: "x", start: 100 },
		expected: ["R100", "R101"],
	},
	{
		name: "mixed prefixes allocate separate number sequences",
		ir: {
			parts: [
				makePart("p1", "R?", 10, 0),
				makePart("p2", "C?", 20, 0),
				makePart("p3", "U?", 30, 0),
				makePart("p4", "R?", 40, 0),
				makePart("p5", "C?", 50, 0),
			],
		},
		opts: { mode: "reset", order: "x", start: 1 },
		expected: ["R1", "C1", "U1", "R2", "C2"],
	},
	{
		name: "changes list records modified parts with id, from, and to",
		ir: {
			parts: [
				makePart("p1", "R1", 0, 0),
				makePart("p2", "R?", 10, 0),
				makePart("p3", "R?", 20, 0),
			],
		},
		opts: { mode: "keep", order: "x", start: 1 },
		expected: [
			{ id: "p2", from: "R?", to: "R2" },
			{ id: "p3", from: "R?", to: "R3" },
		],
		extract: (res) => res.changes,
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

	for (const tc of ANNOTATE_CASES) {
		test(tc.name, () => {
			const res = annotate(tc.ir, tc.opts);
			const actual = tc.extract
				? tc.extract(res)
				: res.ir.parts.map((p) => p.ref);
			assert.deepEqual(actual, tc.expected);
		});
	}

	test("input ir and parts are not mutated", () => {
		const { ir, res } = makeFrozenFixture();
		for (const [actual, original] of [
			[res.ir, ir],
			[res.ir.parts, ir.parts],
		]) {
			assert.notEqual(actual, original);
		}
		for (const [actual, expected] of [
			[ir.parts[0].ref, "R?"],
			[ir.parts[1].ref, "R?"],
			[res.ir.parts[0].ref, "R1"],
			[res.ir.parts[1].ref, "R2"],
		]) {
			assert.equal(actual, expected);
		}
	});
});
