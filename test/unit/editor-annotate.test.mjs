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

// [ref, expected] pairs
const REF_PREFIX_CASES = [
	["R?", "R"],
	["U12", "U"],
	["SW_1", "SW_"],
	["#PWR1", "#PWR"],
	["C", "C"],
	["12", "X"],
	["?", "X"],
	["", "X"],
	[null, "X"],
	[undefined, "X"],
];

// [ref, expected] pairs
const REF_NUMBER_CASES = [
	["R12", 12],
	["U3", 3],
	["SW_1", 1],
	["R0", 0],
	["123", 123],
	["R?", null],
	["R", null],
	["R12?", null],
	["", null],
	[null, null],
];

/** Builds parts p1..pN from [ref, x, y] tuples. */
function partsOf(...specs) {
	return specs.map(([ref, x, y], i) => makePart(`p${i + 1}`, ref, x, y));
}

/** Builds parts p1..pN on y=0, spaced 10 apart starting at x0. */
function inRow(x0, ...refs) {
	return partsOf(...refs.map((ref, i) => [ref, x0 + 10 * i, 0]));
}

/** Expected [{ id, ref }] for parts p1..pN. */
function idRefs(...refs) {
	return refs.map((ref, i) => ({ id: `p${i + 1}`, ref }));
}

const refsById = (res) => res.ir.parts.map((p) => ({ id: p.id, ref: p.ref }));

// [parts, expected duplicate refs]
const DUPLICATE_REF_CASES = [
	[partsOf(["R1"], ["R2"]), []],
	[partsOf(["R1"], ["R1"], ["R2"]), ["R1"]],
	[partsOf(["R1"], ["C1"], ["R1"], ["C1"]), ["R1", "C1"]],
	[[], []],
];

const KEEP_X = { mode: "keep", order: "x", start: 1 };
const RESET_X = { mode: "reset", order: "x", start: 1 };

const ANNOTATE_CASES = [
	{
		name: "default options with unannotated parts",
		parts: partsOf(["C?"], ["C?"]),
		opts: undefined,
		expected: ["C1", "C2"],
	},
	{
		name: "keep mode skips existing numbers and handles non-standard prefixes",
		parts: partsOf(["SW_1"], ["SW_?"]),
		opts: { mode: "keep", start: 1 },
		expected: ["SW_1", "SW_2"],
	},
	{
		name: "empty ir handles gracefully",
		parts: [],
		opts: {},
		expected: [],
	},
	{
		name: "keep mode fills gaps in x order",
		parts: inRow(0, "R1", "R?", "R3", "R?"),
		opts: KEEP_X,
		expected: ["R1", "R2", "R3", "R4"],
	},
	{
		name: "reset mode renumbers by position",
		parts: partsOf(["R9", 30, 0], ["R1", 10, 0], ["R?", 20, 0]),
		opts: RESET_X,
		expected: idRefs("R3", "R1", "R2"),
		extract: refsById,
	},
	{
		name: "order y sorts primarily by y coordinate",
		parts: partsOf(["R?", 10, 50], ["R?", 30, 10], ["R?", 20, 10]),
		opts: { mode: "reset", order: "y", start: 1 },
		expected: idRefs("R3", "R2", "R1"),
		extract: refsById,
	},
	{
		name: "start 100 begins numbering at 100",
		parts: inRow(10, "R?", "R?"),
		opts: { mode: "reset", order: "x", start: 100 },
		expected: ["R100", "R101"],
	},
	{
		name: "mixed prefixes allocate separate number sequences",
		parts: inRow(10, "R?", "C?", "U?", "R?", "C?"),
		opts: RESET_X,
		expected: ["R1", "C1", "U1", "R2", "C2"],
	},
	{
		name: "changes list records modified parts with id, from, and to",
		parts: inRow(0, "R1", "R?", "R?"),
		opts: KEEP_X,
		expected: [
			{ id: "p2", from: "R?", to: "R2" },
			{ id: "p3", from: "R?", to: "R3" },
		],
		extract: (res) => res.changes,
	},
];

describe("annotate module", () => {
	for (const [title, fn, cases] of [
		[
			"refPrefix extracts prefix according to rules",
			refPrefix,
			REF_PREFIX_CASES,
		],
		[
			"refNumber extracts trailing integer or null",
			refNumber,
			REF_NUMBER_CASES,
		],
		[
			"findDuplicateRefs identifies repeated references",
			(parts) => findDuplicateRefs({ parts }),
			DUPLICATE_REF_CASES,
		],
	]) {
		test(title, () => {
			for (const [input, expected] of cases) {
				assert.deepEqual(fn(input), expected);
			}
		});
	}

	for (const tc of ANNOTATE_CASES) {
		test(tc.name, () => {
			const res = annotate({ parts: tc.parts }, tc.opts);
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
